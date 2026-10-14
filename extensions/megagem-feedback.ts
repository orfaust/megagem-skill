import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFeedbackGuard } from "./feedback-guard.ts";
import { createFeedbackMonitor, publishFeedbackToPi } from "./feedback-monitor.ts";
import { createImmediateDelivery } from "./pending-notice.ts";
import { checkDispatchPolicy, checkLiveStartup, claudePreflight, parseClaudeStartup, parseStartup, selectRoute, startRecord, startupFor, START_ENTRY } from "./dispatch-policy.ts";
import { createConsentTickets } from "./dispatch-consent.ts";
import { join } from "node:path";
import { listProviders, loadPreferences, STORE_NAME } from "./provider-priority.ts";
import { discoverAgents } from "./agent-discovery.ts";

const exec = promisify(execFile);
const ENTRY_TYPE = "megagem-feedback-job";
const CONFLICT_ENTRY = "megagem-deny-conflict";

async function herdr(args: string[]) {
  if (process.env.HERDR_ENV !== "1") throw new Error("Megagem requires a Herdr-managed Pi pane (HERDR_ENV=1)");
  const { stdout } = await exec("herdr", args, { timeout: 12_000, maxBuffer: 1024 * 1024, windowsHide: true });
  return JSON.parse(stdout);
}

export default function (pi: ExtensionAPI) {
  const guard = createFeedbackGuard();
  // Same Pi agent directory used by /megagem-provider, including PI_CODING_AGENT_DIR.
  let preferencesPath: string | undefined;
  const policyPath = async () => {
    if (!preferencesPath) {
      const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
      preferencesPath = join(getAgentDir(), STORE_NAME);
    }
    return preferencesPath;
  };
  let modelRegistry: any;
  const delivery = createImmediateDelivery({ publish: job => publishFeedbackToPi(pi, job) });

  const route = async (explicit: { agent?: string; provider?: string } = {}) => {
    const config = await loadPreferences(await policyPath());
    const discovered = await discoverAgents();
    const providers = listProviders(modelRegistry);
    // Herdr kind support and native CLI readiness must be checked live by the coordinator.
    // Only Pi is executable through megagem_start; Claude remains a blocker until independently verified.
    const agents = discovered.map(a => ({ ...a, supported: a.name === "pi" || a.name === "claude" }));
    return selectRoute({ agents, providers, config, explicit });
  };

  // Only this extension's successful start creates provenance. A prompt cannot supply its own proof.
  let currentBranch: () => any[] = () => [];
  const consentTickets = createConsentTickets({ branch: () => currentBranch(), lookup: startupFor, conflictMarker: CONFLICT_ENTRY });
  const monitor = createFeedbackMonitor({
    run: herdr,
    authorize: async (candidate, live) => {
      const record = startupFor(currentBranch(), candidate);
      checkLiveStartup(live, candidate, record);
      if (candidate.requestedAgent && candidate.requestedAgent !== record.agent ||
          candidate.requestedProvider && candidate.requestedProvider !== record.provider)
        throw new Error("Explicit choice does not match verified worker; no prompt sent");
      if (candidate.consent && typeof candidate.consent !== "string") throw new Error("Invalid consent ticket; no prompt sent");
      const ticket = candidate.consent ? consentTickets.consume(candidate.consent, candidate) : undefined;
      try { await checkDispatchPolicy(record, { path: await policyPath(), consent: ticket }); }
      catch (error) {
        if (error instanceof Error && error.message.includes("deny blocks this prompt"))
          pi.appendEntry(CONFLICT_ENTRY, { paneId: candidate.paneId, sessionId: candidate.sessionId,
            taskLabel: candidate.taskLabel, model: record.model });
        throw error;
      }
      if (!ticket) {
        const decision = await route({ agent: candidate.requestedAgent, provider: candidate.requestedProvider });
        if (decision.action === "ask") throw new Error(`Routing blocked: ${decision.reason}; no prompt sent`);
        if (decision.pair.agent !== record.agent || decision.pair.provider !== record.provider)
          throw new Error(`Worker ${record.agent}/${record.provider} is not top-ranked (${decision.pair.agent}/${decision.pair.provider}); ask before reusing a different route; no prompt sent`);
      }
    },
    save: (data: unknown) => pi.appendEntry(ENTRY_TYPE, data),
    publish: (job: any) => delivery.deliver(job),
  });

  function onSession(ctx: ExtensionContext) {
    modelRegistry = ctx.modelRegistry;
    currentBranch = () => ctx.sessionManager.getBranch();
    consentTickets.clear();
  }

  function restore(ctx: ExtensionContext) {
    monitor.restore(ctx.sessionManager.getBranch()
      .filter(entry => entry.type === "custom" && entry.customType === ENTRY_TYPE)
      .map(entry => entry.data));
  }
  pi.on("session_start", (_event, ctx) => { guard.reset(); onSession(ctx); restore(ctx); });
  pi.on("session_tree", (_event, ctx) => { guard.reset(); onSession(ctx); restore(ctx); });
  pi.on("session_shutdown", () => { monitor.stop(); consentTickets.clear(); guard.reset(); });
  pi.on("message_end", event => { guard.onMessageEnd(event.message); });
  pi.on("agent_settled", (event, ctx) => {
    const result = guard.settled({ aborted: event.aborted });
    if (result?.retry) pi.sendUserMessage(result.retry, { deliverAs: "followUp" }); // Deferred by Pi until settlement completes.
    if (result?.alert) {
      if (ctx.hasUI) ctx.ui.notify(result.alert.text, "warning");
      pi.sendMessage(result.alert.message, { triggerTurn: false }); // Visible, durable, never starts a turn.
    }
  });

  pi.registerTool({
    name: "megagem_route",
    label: "Megagem routing decision",
    description: "Read current priorities and live Pi provider/CLI inventory before selecting a worker. Unknown Claude provider/auth/model blocks automatic Pi fallback; this is a decision, not proof of worker startup. Supply explicit agent/provider when requested by the user. Verify Herdr-supported kinds and target-worker authentication separately; never invent a Claude provider.",
    parameters: Type.Object({ requestedAgent: Type.Optional(Type.String()), requestedProvider: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      const decision = await route({ agent: params.requestedAgent, provider: params.requestedProvider });
      return { content: [{ type: "text" as const, text: decision.action === "ask"
        ? `Routing blocked: ${decision.reason}. No worker started. Ask the user before using Pi or another route.`
        : `Top verified pair: ${decision.pair.agent}/${decision.pair.provider} (${decision.pair.priority}). Before startup verify model, Herdr kind, worker auth and CLI flags. Ranked pairs: ${decision.ranked.map(pair => `${pair.agent}/${pair.provider}:${pair.priority}`).join(", ")}.` }], details: decision };
    },
  });

  pi.registerTool({
    name: "megagem_claude_preflight",
    label: "Claude startup diagnostic",
    description: "Check Claude flags, Herdr kind and local auth without starting a worker. This does NOT establish provider/model/auth inside the target pane and never grants dispatch; report the blocker, never silently fall back to Pi.",
    parameters: Type.Object({ paneId: Type.String(), args: Type.Array(Type.String()) }),
    async execute(_id, params) {
      if (params.paneId === process.env.HERDR_PANE_ID) throw new Error("Cannot preflight in the coordinator pane");
      // Syntax check happens before any CLI invocation; do not log CLI auth output or credentials.
      const parsed = parseClaudeStartup(params.args);
      if (process.env.HERDR_ENV !== "1") throw new Error("Megagem requires HERDR_ENV=1; no worker started");
      const [authResult, helpResult, herdrHelp] = await Promise.all([
        exec("claude", ["auth", "status", "--json"], { timeout: 8000, maxBuffer: 16_384, windowsHide: true }),
        exec("claude", ["--help"], { timeout: 8000, maxBuffer: 64_000, windowsHide: true }),
        exec("herdr", ["agent", "start", "--help"], { timeout: 8000, maxBuffer: 64_000, windowsHide: true }),
      ]).catch(() => { throw new Error("Claude/Herdr local diagnostics failed; no worker started"); });
      let auth: any;
      try { auth = JSON.parse(authResult.stdout); } catch { throw new Error("Claude auth status unreadable; no worker started"); }
      const result = claudePreflight({ auth, help: helpResult.stdout, herdrHelp: herdrHelp.stdout, environment: process.env });
      // Never include the raw auth JSON, environment or CLI output in the result.
      return { content: [{ type: "text" as const, text: `${result.reason} Requested Claude model ${parsed.model} and effort ${parsed.effort} were NOT started. Coordinator auth is not worker auth. Check the target pane and establish trusted provider/model/auth attestation before enabling Claude dispatch.` }], details: { ready: false, reason: result.reason } };
    },
  });

  pi.registerTool({
    name: "megagem_start",
    label: "Megagem verified worker start",
    description: "Start a fresh Pi worker through Herdr only when current routing permits it; unknown preferred Claude blocks silent fallback. Requires explicit --model provider/model. Pass requestedAgent/requestedProvider for an explicit user choice; never claim an unrecorded choice. Denied startup cannot be consented here; ask the user to change priorities or choose an allowed route.",
    parameters: Type.Object({ name: Type.String(), paneId: Type.String(), args: Type.Array(Type.String()), requestedAgent: Type.Optional(Type.String()), requestedProvider: Type.Optional(Type.String()) }),
    async execute(_id, params) {
      if (params.paneId === process.env.HERDR_PANE_ID) throw new Error("Cannot start a worker in the coordinator pane");
      const parsed = parseStartup("pi", params.args);
      if (params.requestedAgent && params.requestedAgent !== parsed.agent ||
          params.requestedProvider && params.requestedProvider !== parsed.provider)
        throw new Error("Explicit choice does not match requested Pi model; no worker started");
      // Do not silently demote a preferred but unverified Claude to Pi, even on direct start.
      const decision = await route({ agent: params.requestedAgent, provider: params.requestedProvider });
      if (decision.action === "ask") throw new Error(`Routing blocked: ${decision.reason}; no worker started`);
      if (decision.pair.agent !== "pi" || decision.pair.provider !== parsed.provider)
        throw new Error("Requested Pi route is not top-ranked; ask before substituting; no worker started");
      // Do not consume credits/start a denied worker before consent; no implicit exceptions at startup.
      await checkDispatchPolicy({ ...parsed, paneId: params.paneId, sessionId: "startup" }, { path: await policyPath() });
      await herdr(["agent", "start", params.name, "--kind", "pi", "--pane", params.paneId, "--", ...params.args]);
      const observed = await herdr(["agent", "get", params.paneId]);
      const record = startRecord(observed, params, parsed);
      pi.appendEntry(START_ENTRY, record);
      return { content: [{ type: "text" as const, text: `Started ${record.agent} ${record.model} in ${record.paneId}; use returned Herdr session identity for dispatch.` }], details: record };
    },
  });

  pi.registerTool({
    name: "megagem_dispatch",
    label: "Megagem dispatch and feedback",
    description: "Submit one verified Pi worker prompt without waiting. Re-rank against fresh inventory and priorities, including idle reuse; unknown preferred Claude blocks silent fallback. Pass requestedAgent/requestedProvider for an explicit user choice. Deny requires one-task consent. Unknown provenance fails closed. Never pass the coordinator pane.",
    parameters: Type.Object({
      paneId: Type.String(),
      tabId: Type.String(),
      workspaceId: Type.String(),
      sessionId: Type.String({ description: "agent_session.value from herdr agent get/start" }),
      project: Type.String({ description: "Absolute canonical project cwd of the worker" }),
      taskLabel: Type.String({ maxLength: 120 }),
      prompt: Type.String(),
      consent: Type.Optional(Type.String({ description: "Single-use ticket from megagem_consent, only after the user explicitly confirms this exact denied task" })),
      requestedAgent: Type.Optional(Type.String({ description: "Explicit user agent choice, when present; must match verified worker" })),
      requestedProvider: Type.Optional(Type.String({ description: "Explicit user provider choice, when present; must match verified worker" })),
    }),
    async execute(_id, params) {
      if (params.paneId === process.env.HERDR_PANE_ID) throw new Error("Cannot dispatch to the coordinator's own pane");
      const result = await monitor.dispatch(params);
      return { content: [{ type: "text" as const, text: `Submitted to ${result.paneId}; worker feedback will automatically wake the coordinator for verification. Submission is not success.` }], details: result };
    },
  });

  pi.registerTool({
    name: "megagem_consent",
    label: "Megagem explicit exception",
    description: "Prepare a single-use ticket ONLY after a user explicitly confirms the denied agent/provider/model for this exact task. This tool cannot verify a human response by itself; it requires an exact matching user message in the session branch after the deny conflict was reported.",
    parameters: Type.Object({ paneId: Type.String(), tabId: Type.String(), workspaceId: Type.String(), sessionId: Type.String(),
      project: Type.String(), taskLabel: Type.String(), prompt: Type.String(),
      confirmation: Type.String({ description: "Exact text of the user's explicit confirmation, mentioning the denied agent/provider/model and this task" }),
    }),
    async execute(_id, params) {
      const token = consentTickets.issue(params);
      return { content: [{ type: "text" as const, text: `One-task exception ticket: ${token}. Dispatch still rechecks preferences and worker identity.` }], details: { token } };
    },
  });
}
