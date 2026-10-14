export const EVENT_NOTICE = "[Megagem automatic worker notification - not typed by the user] ";
export const RETRY_NOTICE = "[Megagem automatic reminder - not typed by the user] ";
export const ALERT_TYPE = "megagem-feedback-alert";

type Pending = { id: string; task: string; state: string; pane: string; attempts: number };

const textOf = (message: any): string => typeof message?.content === "string" ? message.content
  : (Array.isArray(message?.content) ? message.content : []).filter((block: any) => block?.type === "text").map((block: any) => String(block.text)).join("");

function parseEvent(message: any) {
  if (message?.role !== "user") return undefined;
  const text = textOf(message);
  if (!text.startsWith(EVENT_NOTICE)) return undefined;
  const raw = /Megagem worker event: (\{.*?\})\. /s.exec(text)?.[1];
  try {
    const data = JSON.parse(raw ?? "");
    return { id: String(data.feedbackId ?? data.session ?? "unkeyed"), task: String(data.task ?? "unknown task"), state: String(data.state ?? "unknown"), pane: String(data.pane ?? "?") };
  } catch {
    return { id: "unparsed", task: "unknown task", state: "unknown", pane: "?" };
  }
}

/**
 * Guards a worker event whose coordinator turn ends without visible text. Events are delivered as user-role
 * messages (custom-role triggers were measured to yield empty replies far more often). When Pi settles with
 * an event still unanswered it asks ONCE more through the same path, then alerts once. It never infers worker
 * success and embeds only coordinator-owned fields (task label, state, pane), never worker output.
 */
export function createFeedbackGuard() {
  const pending = new Map<string, Pending>();
  const describe = (items: Pending[]) => items.map(item => `${item.task} (${item.state}, pane ${item.pane})`).join("; ");

  return {
    get pending() { return pending.size; },
    reset() { pending.clear(); },
    /** Feed every message_end event. */
    onMessageEnd(message: any) {
      const event = parseEvent(message);
      if (event) {
        if (!pending.has(event.id)) pending.set(event.id, { ...event, attempts: 0 });
      } else if (message?.role === "assistant" && textOf(message).trim() !== "") {
        pending.clear(); // Visible text is the answer; a tool-call-only message is not.
      }
    },
    /** agent_settled: nothing else will run automatically. Returns a retry prompt and/or a final alert. */
    settled({ aborted = false }: { aborted?: boolean } = {}) {
      if (pending.size === 0) return undefined;
      const items = [...pending.values()];
      const fresh = items.filter(item => item.attempts === 0);
      if (!aborted && fresh.length > 0) {
        for (const item of fresh) item.attempts = 1;
        return { retry: `${RETRY_NOTICE}Your last turn after the worker event for ${describe(fresh)} produced no visible reply. The event is NOT proof of success. Check that worker with herdr agent get/read, verify actual files/tests, then tell the user the verified result or the blocker in this chat. Do not approve prompts, re-send prompts or run queued work.` };
      }
      pending.clear();
      const text = `Megagem: a worker event arrived for ${describe(items)} but the coordinator gave no visible reply${items.some(item => item.attempts > 0) ? " even after one automatic retry" : ""}. The result is NOT verified. Ask Pi to check that worker (herdr agent get/read) or inspect its tab.`;
      return { alert: { text, message: { customType: ALERT_TYPE, content: text, display: true, details: { feedbackIds: items.map(item => item.id) } } } };
    },
  };
}
