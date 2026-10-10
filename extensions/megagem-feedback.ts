import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFeedbackGuard } from "./feedback-guard.ts";
import { createFeedbackMonitor, publishFeedbackToPi } from "./feedback-monitor.ts";

const exec = promisify(execFile);
const ENTRY_TYPE = "megagem-feedback-job";

async function herdr(args: string[]) {
  if (process.env.HERDR_ENV !== "1") throw new Error("Megagem requires a Herdr-managed Pi pane (HERDR_ENV=1)");
  const { stdout } = await exec("herdr", args, { timeout: 12_000, maxBuffer: 1024 * 1024, windowsHide: true });
  return JSON.parse(stdout);
}

export default function (pi: ExtensionAPI) {
  const monitor = createFeedbackMonitor({
    run: herdr,
    save: (data: unknown) => pi.appendEntry(ENTRY_TYPE, data),
    publish: (job: { state: string; taskLabel: string; project: string; paneId: string; tabId: string; workspaceId: string; sessionId: string }) => publishFeedbackToPi(pi, job),
  });

  function restore(ctx: ExtensionContext) {
    monitor.restore(ctx.sessionManager.getBranch()
      .filter(entry => entry.type === "custom" && entry.customType === ENTRY_TYPE)
      .map(entry => entry.data));
  }
  const guard = createFeedbackGuard();
  pi.on("session_start", (_event, ctx) => { guard.reset(); restore(ctx); });
  pi.on("session_tree", (_event, ctx) => { guard.reset(); restore(ctx); });
  pi.on("session_shutdown", () => { monitor.stop(); guard.reset(); });
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
    name: "megagem_dispatch",
    label: "Megagem dispatch and feedback",
    description: "Submit one verified Herdr worker prompt without waiting and arrange an automatic feedback turn in this Pi chat. Use instead of herdr agent prompt after creating/starting the worker. Never pass the coordinator's own pane.",
    parameters: Type.Object({
      paneId: Type.String(),
      tabId: Type.String(),
      workspaceId: Type.String(),
      sessionId: Type.String({ description: "agent_session.value from herdr agent get/start" }),
      project: Type.String({ description: "Absolute canonical project cwd of the worker" }),
      taskLabel: Type.String({ maxLength: 120 }),
      prompt: Type.String(),
    }),
    async execute(_id, params) {
      if (params.paneId === process.env.HERDR_PANE_ID) throw new Error("Cannot dispatch to the coordinator's own pane");
      const result = await monitor.dispatch(params);
      return { content: [{ type: "text" as const, text: `Submitted to ${result.paneId}; feedback will arrive automatically when the worker settles or needs attention. Submission is not success.` }], details: result };
    },
  });
}
