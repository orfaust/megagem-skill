export const QUIET_ENTRY_TYPE = "megagem-quiet-mode";

const ERROR_NOTICE = "⚠ A tool call failed (details hidden by Megagem quiet mode; run /quiet-mode off to inspect).";

/** Parses the argument of /quiet-mode. Returns "on" | "off" | "status" | "toggle", or undefined if invalid. */
export function parseQuietArgument(args) {
  const value = String(args ?? "").trim().toLowerCase();
  if (value === "") return "toggle";
  if (["on", "off", "status"].includes(value)) return value;
  return undefined;
}

/** Session-scoped quiet flag. Off by default; persisted as a non-context custom session entry. */
export function createQuietMode({ save }) {
  let enabled = false;
  return {
    get enabled() { return enabled; },
    /** Restores the last persisted value from custom entries of the active branch (oldest first). */
    restore(entries) {
      enabled = false;
      for (const entry of entries ?? []) if (entry?.enabled === true) enabled = true; else if (entry?.enabled === false) enabled = false;
    },
    set(value) {
      const next = Boolean(value);
      const changed = next !== enabled;
      enabled = next;
      if (changed) save({ enabled });
      return changed;
    },
  };
}

function component(render) {
  return { render, invalidate() {} };
}

// The host's bash/powershell renderer starts a one-second timer for "Elapsed" / "Took".
// Quiet replaces that renderer; cancel an interval left by a previously visible row so
// an invisible tool does not keep requesting redraws. Do not alter the recorded duration.
function stopVisibleToolTimer(context) {
  const state = context?.state;
  if (state?.interval !== undefined) {
    clearInterval(state.interval);
    state.interval = undefined;
  }
}

/**
 * Tool renderer resolver for pi.registerToolRenderer(). It only changes how Pi *draws* calls and results in the
 * TUI; tools, approvals, tool_call/tool_result handlers and session history are untouched. While quiet mode is
 * off every slot delegates to `next()` unchanged. The wrapper reads the flag lazily, so existing transcript rows
 * switch when Pi re-renders them.
 */
export function createQuietToolRenderer(quiet) {
  return (_toolName, next) => {
    const base = next();
    if (!base && !quiet.enabled) return undefined;
    return {
      get renderShell() { return quiet.enabled ? "self" : base?.renderShell; },
      get renderCall() { return quiet.enabled ? (_args, _theme, context) => { stopVisibleToolTimer(context); return component(() => []); } : base?.renderCall; },
      get renderResult() {
        return quiet.enabled
          ? (_result, _options, theme, context) => {
            stopVisibleToolTimer(context);
            return component(width => {
              if (!context?.isError || context.isPartial || width < 1) return [];
              const text = Array.from(ERROR_NOTICE).slice(0, width).join("");
              return [theme?.fg ? theme.fg("error", text) : text];
            });
          }
          : base?.renderResult;
      },
    };
  };
}
