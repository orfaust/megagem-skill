import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { discoverAgents } from "./agent-discovery.ts";
import { formatPriorityList, listProviders, loadPreferences, parseProviderArgs, priorityOf, providerStorePath, STORE_NAME, savePreferences, updatePriority } from "./provider-priority.ts";
import { join } from "node:path";

// Writes in this Pi extension instance are serialized; external edits must not race the command.
export function createProviderCommand({ path, notify, discover = discoverAgents, showTable } = {}) {
  // Resolve the host's agent directory lazily; unit tests pass a temp path and never import Pi.
  const store = path ?? providerStorePath();
  let queue = Promise.resolve();
  const message = (ctx: ExtensionCommandContext, text: string, type: "info" | "warning" | "error" = "info") => {
    if (notify) notify(text, type);
    else ctx.ui.notify(text, type);
  };

  async function execute(args: string, ctx: ExtensionCommandContext) {
    const action = parseProviderArgs(args);
    if (!action) return message(ctx, "Usage: /megagem-provider [status | set [provider|agent] <name> <high|normal|low|deny> | reset [provider|agent] <name>]", "warning");
    try {
      const providers = listProviders(ctx.modelRegistry);
      const agents = await discover();
      if (!Array.isArray(agents) || agents.some(agent => typeof agent.name !== "string" || typeof agent.installed !== "boolean")) throw new Error("CLI inventory unavailable");
      const installed = agents.filter(agent => agent.installed).map(agent => agent.name);
      const current = await loadPreferences(store);
      async function persist(kind: string, name: string, priority: string | undefined) {
        const available = kind === "agent" ? installed : providers;
        // Re-read before every change, including a TUI keypress, so stale state is never overwritten.
        const next = updatePriority(await loadPreferences(store), available, name, priority, kind);
        await savePreferences(next, store);
        return next;
      }
      if (action.action === "list") {
        const piPriority = priorityOf(current, "pi", "agent");
        if (ctx.mode !== "tui" || !ctx.hasUI)
          message(ctx, `${formatPriorityList(providers, agents, current)}\nPi agent priority: ${piPriority}`);
        if (ctx.mode !== "tui" || !ctx.hasUI || (!providers.length && !agents.some(agent => agent.name !== "pi" && agent.installed))) return;
        const table = showTable ?? (async (options) => {
          const [{ createProviderTable }, keys] = await Promise.all([import("./provider-table.ts"), import("@earendil-works/pi-tui")]);
          return ctx.ui.custom((tui, theme, _kb, done) => createProviderTable({ tui, theme, done, keys, ...options }));
        });
        await table({ providers, agents: agents.filter(agent => agent.name !== "pi" && agent.installed), initial: current, save: async (row, priority) => {
          const freshProviders = listProviders(ctx.modelRegistry);
          const freshAgents = await discover();
          if (!Array.isArray(freshAgents) || freshAgents.some(agent => typeof agent.name !== "string" || typeof agent.installed !== "boolean")) throw new Error("CLI inventory unavailable");
          const allowed = row.kind === "agent" ? freshAgents.filter(agent => agent.installed).map(agent => agent.name) : freshProviders;
          const updated = updatePriority(await loadPreferences(store), allowed, row.name, priority, row.kind);
          await savePreferences(updated, store);
          // The interactive table shows save feedback; do not print an extra notification over it.
          return updated;
        } });
        return;
      }
      const available = action.kind === "agent" ? installed : providers;
      if (!available.includes(action.name)) return message(ctx, `${action.kind} ${action.name} not currently available; preferences unchanged.`, "warning");
      const next = await persist(action.kind, action.name, action.action === "reset" ? undefined : action.priority);
      message(ctx, `Saved ${action.kind} ${action.name}: ${priorityOf(next, action.name, action.kind)}. Applies before the next Megagem prompt, including idle worker reuse; running work unchanged.`);
    } catch (error) {
      message(ctx, `Preferences not changed: ${error instanceof Error ? error.message : String(error)}.`, "error");
    }
  }

  return (args: string, ctx: ExtensionCommandContext) => {
    const result = queue.then(() => execute(args, ctx));
    queue = result.catch(() => {});
    return result;
  };
}

export default function (pi: ExtensionAPI) {
  let handler: ReturnType<typeof createProviderCommand> | undefined;
  pi.registerCommand("megagem-provider", {
    description: "Provider and coding-agent priorities: /megagem-provider [set agent <name> <high|normal|low|deny>]",
    handler: async (args, ctx) => {
      if (!handler) {
        // Resolve Pi's official agent directory on first invocation, not while importing tests.
        const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
        handler = createProviderCommand({ path: join(getAgentDir(), STORE_NAME) });
      }
      return handler(args, ctx);
    },
  });
}
