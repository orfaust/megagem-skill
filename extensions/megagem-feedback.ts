import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { createFeedbackGuard } from "./feedback-guard.ts";
import { createFeedbackMonitor, publishFeedbackToPi } from "./feedback-monitor.ts";
import { noticeText, resolveLanguage } from "./banner-text.ts";
import { createDeferredDelivery, createPendingNotices } from "./pending-notice.ts";

const exec = promisify(execFile);
const ENTRY_TYPE = "megagem-feedback-job";

async function herdr(args: string[]) {
  if (process.env.HERDR_ENV !== "1") throw new Error("Megagem requires a Herdr-managed Pi pane (HERDR_ENV=1)");
  const { stdout } = await exec("herdr", args, { timeout: 12_000, maxBuffer: 1024 * 1024, windowsHide: true });
  return JSON.parse(stdout);
}

/** Best-effort live labels and agent name for the banner. Never invent a value. */
async function enrichNotice(job: any) {
  const enriched = { ...job };
  try { enriched.agentName = (await herdr(["agent", "get", job.paneId])).result?.agent?.name; } catch { /* keep fallback */ }
  try { enriched.workspaceLabel = (await herdr(["workspace", "get", job.workspaceId])).result?.workspace?.label; } catch { /* keep fallback */ }
  try { enriched.tabLabel = (await herdr(["tab", "get", job.tabId])).result?.tab?.label; } catch { /* keep fallback */ }
  return enriched;
}

/** Last user-role message text in this session branch, for language detection. */
function lastUserText(ctx: ExtensionContext) {
  const branch = ctx.sessionManager.getBranch();
  for (let index = branch.length - 1; index >= 0; index--) {
    const message: any = (branch[index] as any)?.message;
    if (message?.role !== "user") continue;
    const text = typeof message.content === "string" ? message.content
      : (Array.isArray(message.content) ? message.content : []).filter((block: any) => block?.type === "text").map((block: any) => String(block.text)).join(" ");
    if (text.startsWith("[Megagem automatic")) continue; // our own notices are English, never the user's language
    return text;
  }
  return "";
}

export default function (pi: ExtensionAPI) {
  const guard = createFeedbackGuard();
  let ui: any;
  let hasUI = () => false;
  let language = () => resolveLanguage({ explicit: process.env.PI_MEGAGEM_LANG, lastUserText: "" });
  let detachInput: (() => void) | undefined;

  const notices = createPendingNotices({
    ui: {
      setWidget: (key, content, options) => ui?.setWidget?.(key, content, options),
      getEditorText: () => ui?.getEditorText?.() ?? "",
    },
    render: (job, lang) => noticeText(job as any, lang),
    getLanguage: () => language(),
    publish: job => publishFeedbackToPi(pi, job),
    sendDurable: message => pi.sendMessage(message as any, { triggerTurn: false }),
    onRemove: job => guard.release(job.id),
  });

  const delivery = createDeferredDelivery({
    notices,
    hasUI: () => hasUI(),
    publishImmediate: job => publishFeedbackToPi(pi, job),
    markDeferred: job => guard.defer(job.id),
    enrich: enrichNotice,
  });

  const monitor = createFeedbackMonitor({
    run: herdr,
    save: (data: unknown) => pi.appendEntry(ENTRY_TYPE, data),
    publish: (job: any) => { void delivery.deliver(job); },
  });

  function bindInput(ctx: ExtensionContext) {
    detachInput?.();
    detachInput = undefined;
    if (typeof ctx.ui?.onTerminalInput === "function")
      detachInput = ctx.ui.onTerminalInput(data => notices.handleInput(data));
  }

  function onSession(ctx: ExtensionContext) {
    ui = ctx.ui;
    hasUI = () => ctx.hasUI;
    language = () => resolveLanguage({ explicit: process.env.PI_MEGAGEM_LANG, lastUserText: lastUserText(ctx) });
    bindInput(ctx);
  }

  function restore(ctx: ExtensionContext) {
    monitor.restore(ctx.sessionManager.getBranch()
      .filter(entry => entry.type === "custom" && entry.customType === ENTRY_TYPE)
      .map(entry => entry.data));
  }
  pi.on("session_start", (_event, ctx) => { guard.reset(); onSession(ctx); restore(ctx); });
  pi.on("session_tree", (_event, ctx) => { guard.reset(); onSession(ctx); restore(ctx); });
  pi.on("session_shutdown", () => { monitor.stop(); guard.reset(); detachInput?.(); detachInput = undefined; });
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
    description: "Submit one verified Herdr worker prompt without waiting. In an interactive session a persistent notice appears when the worker settles or blocks; press Enter to wake this coordinator and verify, or Ctrl+X to dismiss it. Use instead of herdr agent prompt after creating/starting the worker. Never pass the coordinator's own pane.",
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
      return { content: [{ type: "text" as const, text: `Submitted to ${result.paneId}; a notice will ask you to press Enter to verify when the worker settles or needs attention. Submission is not success.` }], details: result };
    },
  });
}
