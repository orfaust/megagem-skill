import assert from "node:assert/strict";
import test from "node:test";
import { createConsentTickets } from "../extensions/dispatch-consent.ts";

const record = { paneId: "w1:p2", sessionId: "session", agent: "pi", provider: "deepseek", model: "deepseek/deepseek-flash" };
const task = { ...record, taskLabel: "provider-fix", prompt: "repair" };
const confirmation = "Confermo eccezione pi deepseek deepseek/deepseek-flash per provider-fix";
let entries = [];
const tickets = createConsentTickets({ branch: () => entries, lookup: () => record, conflictMarker: "megagem-deny-conflict" });
const conflict = { type: "custom", customType: "megagem-deny-conflict", data: { ...task } };
const user = { message: { role: "user", content: confirmation } };

test("old confirmation, model-generated text and missing conflict do not authorize deny", () => {
  entries = [user, conflict];
  assert.throws(() => tickets.issue({ ...task, confirmation }), /AFTER/);
  entries = [conflict, { message: { role: "assistant", content: confirmation } }];
  assert.throws(() => tickets.issue({ ...task, confirmation }), /confirmation/);
  entries = [user];
  assert.throws(() => tickets.issue({ ...task, confirmation }), /conflict/);
});

test("explicit user confirmation after conflict issues a single-use, task-bound ticket", () => {
  entries = [conflict, user];
  const token = tickets.issue({ ...task, confirmation });
  assert.equal(tickets.consume(token, task).authorized, true);
  assert.equal(tickets.consume(token, task), undefined);
  assert.equal(tickets.consume(tickets.issue({ ...task, confirmation }), { ...task, prompt: "other" }), undefined);
  tickets.clear();
});
