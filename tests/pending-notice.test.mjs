import assert from "node:assert/strict";
import test from "node:test";
import { createImmediateDelivery } from "../extensions/pending-notice.ts";
import { createFeedbackGuard, EVENT_NOTICE } from "../extensions/feedback-guard.ts";
import { publishFeedbackToPi } from "../extensions/feedback-monitor.ts";

const job = (over = {}) => ({ id: "j1", state: "settled", paneId: "w1:p1", ...over });

test("settled, blocked and uncertain events are published immediately without a keypress in any mode", () => {
  for (const mode of ["tui", "rpc", "print", "json"]) {
    const seen = [];
    const delivery = createImmediateDelivery({ publish: entry => seen.push(entry) });
    for (const state of ["settled", "blocked", "uncertain", "interrupted", "monitor_error"])
      delivery.deliver(job({ id: `${mode}-${state}`, state }));
    assert.deepEqual(seen.map(entry => entry.state), ["settled", "blocked", "uncertain", "interrupted", "monitor_error"]);
    assert.deepEqual(seen.map(entry => entry.id), ["settled", "blocked", "uncertain", "interrupted", "monitor_error"].map(state => `${mode}-${state}`));
  }
});

test("back-to-back jobs retain worker identity, order and verified-state warning in the actual Pi follow-up", () => {
  const messages = [];
  const delivery = createImmediateDelivery({ publish: entry => publishFeedbackToPi({ sendUserMessage: (...args) => messages.push(args) }, entry) });
  const first = job({ id: "one", state: "blocked", taskLabel: "first task", workspaceId: "w1", tabId: "w1:t1", paneId: "w1:p1", sessionId: "s1", project: "C:/one" });
  const second = job({ id: "two", state: "interrupted", taskLabel: "second task", workspaceId: "w2", tabId: "w2:t2", paneId: "w2:p2", sessionId: "s2", project: "C:/two" });
  delivery.deliver(first);
  delivery.deliver(second);
  assert.equal(messages.length, 2);
  for (const [index, entry] of [first, second].entries()) {
    const [text, options] = messages[index];
    assert.deepEqual(options, { deliverAs: "followUp" });
    assert.ok(text.startsWith(EVENT_NOTICE));
    const payload = JSON.parse(/Megagem worker event: (\{.*?\})\. /s.exec(text)[1]);
    assert.deepEqual(payload, { feedbackId: entry.id, state: entry.state, task: entry.taskLabel, project: entry.project,
      pane: entry.paneId, tab: entry.tabId, workspace: entry.workspaceId, session: entry.sessionId });
    assert.match(text, /NOT proof the task succeeded/);
  }
});

test("all exceptional worker states demand verification rather than claiming success or authorizing queued prompts", () => {
  const seen = [];
  const delivery = createImmediateDelivery({ publish: entry => publishFeedbackToPi({ sendUserMessage: text => seen.push(text) }, entry) });
  for (const state of ["blocked", "uncertain", "interrupted", "monitor_error"])
    delivery.deliver(job({ id: state, state, taskLabel: state, workspaceId: "w", tabId: "w:t", sessionId: "s" }));
  assert.equal(seen.length, 4);
  for (const [index, state] of ["blocked", "uncertain", "interrupted", "monitor_error"].entries()) {
    assert.match(seen[index], new RegExp(`"state":"${state}"`));
    assert.match(seen[index], /check herdr agent get\/read.*verify actual files\/tests/);
    assert.match(seen[index], /do not approve, repeat the prompt or run queued work automatically/);
  }
});

test("immediate worker feedback retains one reminder and alert when coordinator replies empty", () => {
  const guard = createFeedbackGuard();
  const delivery = createImmediateDelivery({ publish: entry => {
    guard.onMessageEnd({ role: "user", content: `${EVENT_NOTICE}Megagem worker event: ${JSON.stringify({ feedbackId: entry.id, task: "task", state: entry.state, pane: entry.paneId })}. Verify first.` });
  } });
  delivery.deliver(job());
  assert.equal(guard.pending, 1);
  assert.match(guard.settled().retry, /not proof of success/i);
  assert.match(guard.settled().alert.text, /not verified/i);
});
