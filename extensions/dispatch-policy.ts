import { loadPreferences, priorityOf, providerStorePath, PRIORITIES } from "./provider-priority.ts";

// Provenance is generated from a successful start response, not a model-supplied assertion or CSV row.
// Keep it in the coordinator session branch; never copy it from a tab label or Herdr title.
export const START_ENTRY = "megagem-worker-start";

// Claude auth status is only a local diagnostic. Even firstParty OAuth does not
// attest which provider/model the launched worker will use, or authorize a prompt.
export function claudePreflight({ auth, help, herdrHelp, environment } = {}) {
  const flags = typeof help === "string" && /--model\s+<model>/.test(help) && /--effort\s+<level>/.test(help);
  const kind = typeof herdrHelp === "string" && /\bclaude\b/i.test(herdrHelp);
  const loggedIn = auth?.loggedIn === true && auth?.authMethod === "claude.ai" && auth?.apiProvider === "firstParty";
  const conflictingEnvironment = !environment || typeof environment !== "object" ||
    ["ANTHROPIC_BASE_URL", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY", "ANTHROPIC_API_KEY"].some(key => !!environment[key]);
  if (!flags || !kind || !loggedIn || conflictingEnvironment)
    return { ready: false, reason: "Claude local CLI flags, Herdr kind, auth or provider environment not reliably verified; no worker started" };
  return { ready: false, reason: "Claude local auth/flags detected, but target-worker provider, model and authentication are not attested; no worker started. Verify in the target pane with a trusted mechanism before adding Claude startup provenance" };
}

export function parseClaudeStartup(args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string" || !arg) || args.includes("--"))
    throw new Error("Claude startup arguments invalid; no worker started");
  // Do not accept arbitrary flags, aliases, defaults or automatic fallback. No bypass flags.
  if (args.length !== 4 || args[0] !== "--model" || args[2] !== "--effort" ||
      typeof args[1] !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*-[0-9][a-zA-Z0-9._-]*$/.test(args[1]) ||
      !["low", "medium", "high", "xhigh", "max"].includes(args[3]))
    throw new Error("Claude requires exactly --model <full-id> --effort <level>, with no fallback or permission override; no worker started");
  return { agent: "claude", model: args[1], effort: args[3], provider: undefined };
}

export function parseStartup(kind, args) {
  if (!Array.isArray(args) || args.some(arg => typeof arg !== "string" || !arg)) throw new Error("Startup arguments invalid; no worker started");
  if (kind !== "pi") throw new Error("Provider provenance for this agent kind is not verified; no worker started");
  const models = args.flatMap((arg, i) => arg === "--model" ? [args[i + 1]] : []);
  if (args.includes("--") || args.some(arg => /^--(?:model|provider|config)(?:=|$)/.test(arg) && arg !== "--model"))
    throw new Error("Ambiguous startup model/provider flags; no worker started");
  if (models.length !== 1 || typeof models[0] !== "string" || !/^[^\s/]+\/[^\s]+$/.test(models[0]) || args.some(arg => arg.startsWith("--model=")))
    throw new Error("Pass exactly one explicit Pi --model provider/model; provider unknown otherwise");
  return { agent: kind, provider: models[0].split("/")[0], model: models[0] };
}

export function startRecord(started, requested, parsed) {
  // Called only after a successful Herdr start invocation followed by a live agent get.
  const agent = started?.result?.agent;
  if (!agent || agent?.pane_id !== requested.paneId || agent?.agent !== parsed.agent ||
      !agent?.agent_session?.value || agent?.tab_id == null || agent?.workspace_id == null || !agent?.cwd ||
      !["idle", "done"].includes(agent?.agent_status) || agent?.interactive_ready === false)
    throw new Error("Worker start provenance uncertain; do not dispatch until verified");
  return { paneId: agent.pane_id, tabId: agent.tab_id, workspaceId: agent.workspace_id,
    sessionId: agent.agent_session.value, project: agent.cwd, agent: parsed.agent,
    provider: parsed.provider, model: parsed.model };
}

export function startupFor(branch, candidate) {
  // Match exact server-scoped identity and canonical cwd. Reject conflicting records rather than picking latest.
  const records = branch.filter(entry => entry?.type === "custom" && entry.customType === START_ENTRY)
    .map(entry => entry.data).filter(record => record?.paneId === candidate.paneId && record?.sessionId === candidate.sessionId &&
      record?.tabId === candidate.tabId && record?.workspaceId === candidate.workspaceId && samePath(record?.project, candidate.project));
  if (!records.length || records.some(record => record.agent !== "pi" || !record.provider || !record.model ||
      record.model.split("/")[0] !== record.provider || record.agent !== records[0].agent ||
      record.provider !== records[0].provider || record.model !== records[0].model))
    throw new Error("Worker startup model/provider provenance unknown or conflicting; no prompt sent. Start a fresh worker with megagem_start, or ask for verified recovery.");
  return records[0];
}

function samePath(a, b) {
  return typeof a === "string" && typeof b === "string" && !!a && !!b &&
    a.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase() === b.replace(/[\\/]+/g, "/").replace(/\/$/, "").toLowerCase();
}

export function checkLiveStartup(live, candidate, record) {
  if (live?.agent !== record.agent || live?.pane_id !== record.paneId || live?.tab_id !== record.tabId ||
      live?.workspace_id !== record.workspaceId || live?.agent_session?.value !== record.sessionId ||
      !samePath(live?.cwd, record.project) || !samePath(candidate.project, record.project))
    throw new Error("Worker identity changed since verified startup; no prompt sent");
}

export async function checkDispatchPolicy(record, { path = providerStorePath(), consent, load = loadPreferences } = {}) {
  if (record?.agent !== "pi" || !record?.provider || !record?.model || record.model.split("/")[0] !== record.provider)
    throw new Error("Provider provenance unavailable; no prompt sent");
  const config = await load(path); // Fresh for EACH dispatch (including idle reuse), not at startup only.
  const agentPriority = priorityOf(config, record.agent, "agent");
  const providerPriority = priorityOf(config, record.provider);
  if (agentPriority !== "deny" && providerPriority !== "deny") return { agentPriority, providerPriority };
  const conflict = `Worker ${record.agent} ${record.model}: agent=${agentPriority}, provider ${record.provider}=${providerPriority}`;
  if (!consent || consent.agent !== record.agent || consent.provider !== record.provider || consent.model !== record.model ||
      consent.sessionId !== record.sessionId || consent.paneId !== record.paneId || consent.authorized !== true)
    throw new Error(`${conflict}; deny blocks this prompt. Choose an allowed worker or explicitly confirm a one-task exception; no prompt sent.`);
  return { agentPriority, providerPriority };
}

// A CLI on PATH, a Herdr kind, or `claude auth status` does not prove the provider,
// worker-side authentication, model, or native startup flags. Only explicitly verified
// provider inventories may supply pairs. Unknown preferred agents block a silent fallback.
export function selectRoute({ agents, providers, config, explicit = {}, verifiedProviders = {} }) {
  if (!Array.isArray(agents) || !Array.isArray(providers) || !config ||
      !agents.every(a => a && typeof a.name === "string" && typeof a.installed === "boolean" && typeof a.supported === "boolean") ||
      !providers.every(p => typeof p === "string") || !explicit || typeof explicit !== "object" ||
      !verifiedProviders || typeof verifiedProviders !== "object" || Array.isArray(verifiedProviders))
    throw new Error("Routing inventory unreliable; ask before dispatch; no worker started");
  const priority = (agent, provider) => PRIORITIES[Math.max(PRIORITIES.indexOf(priorityOf(config, agent, "agent")), PRIORITIES.indexOf(priorityOf(config, provider)))];
  const usable = agents.filter(a => a.installed && a.supported);
  if (explicit.agent && !usable.some(a => a.name === explicit.agent))
    return { action: "ask", reason: `Requested agent ${explicit.agent} unavailable; no automatic substitute` };
  if (explicit.provider && explicit.agent && explicit.agent !== "pi" && !Array.isArray(verifiedProviders[explicit.agent]))
    return { action: "ask", reason: `Provider for ${explicit.agent} unverified; no automatic substitute` };
  const unknown = usable.filter(a => a.name !== "pi" && !Array.isArray(verifiedProviders[a.name]) &&
    (!explicit.agent || explicit.agent === a.name) && priorityOf(config, a.name, "agent") !== "deny");
  if (explicit.agent && explicit.agent !== "pi" && unknown.some(a => a.name === explicit.agent))
    return { action: "ask", reason: `Requested agent ${explicit.agent} has unknown provider/auth/model; no automatic substitute` };
  if (!explicit.agent && !explicit.provider && unknown.length &&
      (priorityOf(config, "pi", "agent") === "deny" || providers.every(p => priorityOf(config, p) === "deny")))
    return { action: "ask", reason: `Installed agent ${unknown.map(a => a.name).join(", ")} has unknown provider/auth/model; no automatic substitute` };
  if (!explicit.agent && explicit.provider && unknown.length)
    return { action: "ask", reason: `Provider ${explicit.provider} cannot be checked for ${unknown.map(a => a.name).join(", ")}; explicitly choose an agent or verify its provider` };
  const pairs = usable.filter(a => !explicit.agent || a.name === explicit.agent).flatMap(a => {
    const available = a.name === "pi" ? providers : verifiedProviders[a.name];
    if (available === undefined && a.name !== "pi") return [];
    if (!Array.isArray(available) || !available.every(p => typeof p === "string"))
      throw new Error(`Provider inventory unreliable for ${a.name}; ask before dispatch`);
    return available.filter(p => !explicit.provider || explicit.provider === p).map(provider => ({
      agent: a.name, provider, priority: priority(a.name, provider),
    }));
  }).sort((a, b) => PRIORITIES.indexOf(a.priority) - PRIORITIES.indexOf(b.priority) ||
    (a.agent < b.agent ? -1 : a.agent > b.agent ? 1 : 0) ||
    (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0));
  if (explicit.agent || explicit.provider) {
    if (!pairs.length) return { action: "ask", reason: "Requested agent/provider pair unavailable or unverified; no automatic substitute" };
    if ((explicit.agent && explicit.provider && pairs[0].priority === "deny") ||
        (explicit.agent && !explicit.provider && pairs.every(pair => pair.priority === "deny")) ||
        (explicit.provider && !explicit.agent && pairs.every(pair => pair.priority === "deny")))
      return { action: "ask", reason: `Requested ${pairs[0].agent}/${pairs[0].provider} is denied; explicit one-task confirmation required` };
  }
  const eligible = pairs.filter(pair => pair.priority !== "deny");
  const best = eligible[0];
  if (explicit.agent && explicit.provider && best?.agent !== "pi")
    return { action: "ask", reason: `Verified ${best.agent}/${best.provider} cannot be started by this extension; no automatic substitute` };
  // A high agent with unknown provider may rank high if its provider is high; do not
  // treat Pi normal as a safe substitute. This also applies to idle reused Pi sessions.
  if (unknown.some(a => PRIORITIES.indexOf(priorityOf(config, a.name, "agent")) <=
      (best ? PRIORITIES.indexOf(best.priority) : PRIORITIES.indexOf("low")) &&
      (best?.priority !== "high" || priorityOf(config, a.name, "agent") === "high")))
    return { action: "ask", reason: `Preferred agent ${unknown.map(a => a.name).join(", ")} has unknown provider/auth/model; verify in target worker or explicitly choose a verified route` };
  if (!best) return { action: "ask", reason: "No verified eligible agent/provider pair; no automatic substitute" };
  return { action: "select", pair: best, ranked: eligible };
}
