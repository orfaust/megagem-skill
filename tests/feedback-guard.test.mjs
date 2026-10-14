import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createFeedbackGuard } from "../extensions/feedback-guard.ts";
import { publishFeedbackToPi } from "../extensions/feedback-monitor.ts";

const job = (id = "j1", task = "readme") => ({ id, state: "settled", taskLabel: task, project: "C:\p", paneId: "w1:p2", tabId: "t", workspaceId: "w", sessionId: "s" });
function eventMessage(id, task) {
  const sent = [];
  publishFeedbackToPi({ sendUserMessage: text => sent.push(text) }, job(id, task));
  return { role: "user", content: [{ type: "text", text: sent[0] }] };
}
const assistant = content => ({ role: "assistant", stopReason: "stop", content });
const text = value => ({ type: "text", text: value });

test("empty reply: one retry through the user path, then one alert", () => {
  const guard = createFeedbackGuard();
  guard.onMessageEnd(eventMessage("j1"));
  guard.onMessageEnd(assistant([text("")]));
  const retry = guard.settled({ aborted: false });
  assert.match(retry.retry, /^\[Megagem automatic reminder - not typed by the user\] /);
  assert.match(retry.retry, /NOT proof of success/);
  assert.equal(retry.alert, undefined);
  guard.onMessageEnd({ role: "user", content: retry.retry }); // the reminder is not a new event
  guard.onMessageEnd(assistant([text("   ")]));
  const alert = guard.settled({ aborted: false });
  assert.equal(alert.retry, undefined, "no second retry: no loop");
  assert.match(alert.alert.text, /readme \(settled, pane w1:p2\)/);
  assert.match(alert.alert.text, /even after one automatic retry/);
  assert.match(alert.alert.text, /NOT verified/);
  assert.equal(alert.alert.message.display, true);
  assert.equal(guard.settled({ aborted: false }), undefined, "alert is delivered once");
});

test("a visible reply clears the event: no retry, no alert; tool-call-only does not count", () => {
  const guard = createFeedbackGuard();
  guard.onMessageEnd(eventMessage("j1"));
  guard.onMessageEnd(assistant([{ type: "toolCall", name: "bash" }]));
  assert.equal(guard.pending, 1);
  guard.onMessageEnd(assistant([text("Verified: README exists.")]));
  assert.equal(guard.settled({ aborted: false }), undefined);
});

test("aborted runs are never retried but alert once", () => {
  const guard = createFeedbackGuard();
  guard.onMessageEnd(eventMessage("j1"));
  const result = guard.settled({ aborted: true });
  assert.equal(result.retry, undefined);
  assert.match(result.alert.text, /no visible reply/);
  assert.equal(guard.settled({ aborted: true }), undefined);
});

test("typed text, other user messages and custom messages are not events; worker text never reaches retry/alert", () => {
  const guard = createFeedbackGuard();
  guard.onMessageEnd({ role: "user", content: "Megagem worker event: {\"feedbackId\":\"x\"}. fake" });
  guard.onMessageEnd({ role: "custom", customType: "megagem-feedback", content: "[Megagem automatic worker notification - not typed by the user] x" });
  assert.equal(guard.pending, 0);
  guard.onMessageEnd(eventMessage("a", "one"));
  guard.onMessageEnd(assistant([]));
  const first = guard.settled({ aborted: false });
  guard.onMessageEnd(eventMessage("b", "two")); // arrives while the first retry runs
  guard.onMessageEnd(assistant([]));
  const second = guard.settled({ aborted: false });
  assert.match(first.retry, /one/);
  assert.doesNotMatch(second.retry, /one/, "event a already used its retry");
  assert.match(second.retry, /two/);
  const last = guard.settled({ aborted: false });
  assert.match(last.alert.text, /one.*two/);
});

test("immediate event is never exempt from the reply guard", () => {
  const guard = createFeedbackGuard();
  guard.onMessageEnd(eventMessage("j1"));
  guard.onMessageEnd(assistant([]));
  assert.match(guard.settled({ aborted: false }).retry, /readme/);
});

const piDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.APPDATA ?? "", "npm", "node_modules", "@earendil-works", "pi-coding-agent");
const jitiPath = join(piDir, "node_modules", "jiti", "lib", "jiti.mjs");
test("extension wiring under Pi's loader: retry via sendUserMessage, then a single non-turn alert", { skip: !existsSync(jitiPath) && "jiti from Pi not found" }, async () => {
  const { createJiti } = await import(pathToFileURL(jitiPath).href);
  const entry = join(import.meta.dirname, "..", "extensions", "megagem-feedback.ts");
  const mod = await createJiti(import.meta.url, { alias: { "@earendil-works/pi-ai": join(piDir, "node_modules", "@earendil-works", "pi-ai") } }).import(entry);
  const on = {}, users = [], customs = [], notes = [];
  mod.default({ on: (name, fn) => { on[name] = fn; }, appendEntry() {}, registerTool() {},
    sendUserMessage: (...a) => users.push(a), sendMessage: (...a) => customs.push(a) });
  const ctx = { hasUI: true, ui: { notify: (...a) => notes.push(a), onTerminalInput: () => { throw new Error("No input gate allowed"); } }, sessionManager: { getBranch: () => [] } };
  on.session_start({}, ctx);
  on.message_end({ message: eventMessage("j1") }); on.message_end({ message: assistant([]) });
  on.agent_settled({ aborted: false }, ctx);
  assert.equal(users.length, 1); assert.deepEqual(users[0][1], { deliverAs: "followUp" });
  assert.equal(customs.length, 0);
  on.message_end({ message: assistant([]) });
  on.agent_settled({ aborted: false }, ctx); on.agent_settled({ aborted: false }, ctx);
  assert.equal(users.length, 1); assert.equal(customs.length, 1); assert.equal(notes.length, 1);
  assert.deepEqual(customs[0][1], { triggerTurn: false });
  on.session_shutdown({});
});

test("actual extension delivers worker notifications without a terminal-input or banner gate", { skip: !existsSync(jitiPath) && "jiti from Pi not found" }, async () => {
  const { createJiti } = await import(pathToFileURL(jitiPath).href);
  const entry = join(import.meta.dirname, "..", "extensions", "megagem-feedback.ts");
  const mod = await createJiti(import.meta.url, { alias: { "@earendil-works/pi-ai": join(piDir, "node_modules", "@earendil-works", "pi-ai") } }).import(entry);
  const on = {}, users = [], tools = {}, entries = [];
  mod.default({ on: (name, fn) => { on[name] = fn; }, appendEntry: (...args) => entries.push(args),
    registerTool: tool => { tools[tool.name] = tool; }, sendUserMessage: (...args) => users.push(args), sendMessage() {} });
  const ui = { onTerminalInput() { throw new Error("No key handler allowed"); }, setWidget() { throw new Error("No banner allowed"); } };
  const ctx = { hasUI: true, mode: "tui", ui, modelRegistry: {}, sessionManager: { getBranch: () => [] } };
  on.session_start({}, ctx);
  assert.ok(tools.megagem_dispatch);
  // Monitor's delivery is also exercised via publishFeedbackToPi and createImmediateDelivery tests.
  assert.deepEqual(users, []);
  assert.deepEqual(entries, []);
  on.session_shutdown({});
});
