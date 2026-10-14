import { randomUUID } from "node:crypto";

const userText = entry => {
  if (entry?.message?.role !== "user") return "";
  const content = entry.message.content;
  return typeof content === "string" ? content : Array.isArray(content) ?
    content.filter(block => block?.type === "text").map(block => block.text).join(" ") : "";
};

// Exact, non-automatic exception: the user must have supplied a single explicit confirmation
// for the current denied worker and task AFTER the conflict was reported. No model-generated text counts.
export function createConsentTickets({ branch, lookup, conflictMarker }) {
  const tickets = new Map();
  function issue(params) {
    const record = lookup(branch(), params);
    const entries = branch();
    const conflictIndex = entries.findLastIndex(entry => entry?.type === "custom" && entry.customType === conflictMarker &&
      entry.data?.paneId === params.paneId && entry.data?.sessionId === params.sessionId &&
      entry.data?.taskLabel === params.taskLabel && entry.data?.model === record.model);
    const text = params.confirmation;
    if (conflictIndex < 0 || typeof text !== "string" || text.length < 15 || !text.includes(record.agent) ||
        !text.includes(record.provider) || !text.includes(record.model) || !text.includes(params.taskLabel) ||
        !entries.slice(conflictIndex + 1).some(entry => userText(entry) === text))
      throw new Error("No matching user confirmation AFTER this task's denied-provider conflict; no exception issued");
    const token = randomUUID();
    tickets.set(token, { ...record, authorized: true, taskLabel: params.taskLabel, prompt: params.prompt });
    return token;
  }
  function consume(token, candidate) {
    const ticket = tickets.get(token);
    tickets.delete(token);
    return ticket?.paneId === candidate.paneId && ticket?.sessionId === candidate.sessionId &&
      ticket?.taskLabel === candidate.taskLabel && ticket?.prompt === candidate.prompt ? ticket : undefined;
  }
  return { issue, consume, clear: () => tickets.clear() };
}
