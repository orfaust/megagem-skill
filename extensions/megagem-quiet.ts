import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { QUIET_ENTRY_TYPE, createQuietMode, createQuietToolRenderer, parseQuietArgument } from "./quiet-mode.ts";

export default function (pi: ExtensionAPI) {
  const quiet = createQuietMode({ save: (data: unknown) => pi.appendEntry(QUIET_ENTRY_TYPE, data) });

  function restore(ctx: ExtensionContext) {
    quiet.restore(ctx.sessionManager.getBranch()
      .filter(entry => entry.type === "custom" && entry.customType === QUIET_ENTRY_TYPE)
      .map(entry => entry.data));
  }
  pi.on("session_start", (_event, ctx) => restore(ctx));
  pi.on("session_tree", (_event, ctx) => restore(ctx));

  pi.registerToolRenderer(createQuietToolRenderer(quiet));

  // Pi only re-renders rows when the expansion state changes; flip it twice to redraw existing tool rows.
  function redraw(ctx: ExtensionContext) {
    if (ctx.mode !== "tui") return;
    const expanded = ctx.ui.getToolsExpanded();
    ctx.ui.setToolsExpanded(!expanded);
    ctx.ui.setToolsExpanded(expanded);
  }

  pi.registerCommand("quiet-mode", {
    description: "Hide tool calls and outputs in this chat: /quiet-mode [on|off|status]",
    handler: async (args, ctx) => {
      const action = parseQuietArgument(args);
      if (!action) return ctx.ui.notify("Usage: /quiet-mode [on|off|status]", "warning");
      if (action !== "status") {
        quiet.set(action === "toggle" ? !quiet.enabled : action === "on");
        redraw(ctx);
      }
      ctx.ui.notify(quiet.enabled
        ? "Megagem quiet mode is ON: tool calls and outputs are not drawn (tools still run; failures show one line). /quiet-mode off restores them."
        : "Megagem quiet mode is OFF: default Pi tool display.", "info");
    },
  });
}
