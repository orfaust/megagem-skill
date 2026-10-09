import assert from "node:assert/strict";
import test from "node:test";
import { createFeedbackMonitor, publishFeedbackToPi } from "../extensions/feedback-monitor.mjs";

const input = { paneId: "w2:p3", tabId: "w2:t3", workspaceId: "w2", sessionId: "claude-123",
  project: "C:\\Projects\\demo", taskLabel: "readme", prompt: "Inspect the README" };

function rig() {
  let time = 0;
  const timers = [];
  const commands = [];
  const stored = [];
  const events = [];
  let live = { pane_id: input.paneId, tab_id: input.tabId, workspace_id: input.workspaceId,
    agent_session: { value: input.sessionId }, cwd: "c:/projects/demo/", agent_status: "idle", state_change_seq: 40, interactive_ready: true };
  const run = async args => {
    commands.push(args);
    if (args[1] === "get") return { result: { agent: { ...live } } };
    if (args[1] === "prompt") return { result: { type: "agent_prompted", agent: { ...live } } };
    throw Error("Unexpected command");
  };
  const monitor = createFeedbackMonitor({ run, save: data => stored.push(data), publish: data => events.push(data),
    now: () => time, schedule: callback => { timers.push(callback); return callback; }, cancel: callback => {
      const index = timers.indexOf(callback); if (index >= 0) timers.splice(index, 1);
    } });
  return { monitor, commands, stored, events, timers, setLive: changes => { live = { ...live, ...changes }; },
    advance: ms => { time += ms; }, tick: async () => { const callback = timers.shift(); assert.ok(callback, "expected a scheduled check"); callback();
      await new Promise(resolve => setImmediate(resolve)); } };
}

test("dispatch returns immediately and completion produces one feedback, not a success claim", async () => {
  const r = rig();
  const result = await r.monitor.dispatch(input);
  assert.equal(result.state, "submitted");
  assert.deepEqual(r.commands.map(c => c.slice(0, 2)), [["agent", "get"], ["agent", "prompt"]]);
  assert.equal(r.commands[1][3], input.prompt);
  assert.equal(r.events.length, 0);
  assert.equal(r.stored[0].job.prompt, undefined, "prompt text is not persisted");
  await r.tick(); // Old idle state is not completion of this prompt.
  assert.equal(r.events.length, 0);
  r.setLive({ agent_status: "working", state_change_seq: 41 }); await r.tick();
  assert.equal(r.events.length, 0);
  r.setLive({ agent_status: "done", state_change_seq: 42 }); await r.tick();
  assert.equal(r.events[0].state, "settled");
  assert.equal(r.stored.at(-1).stage, "notified");
  assert.equal(r.timers.length, 0);
});

test("fast finish before first check is detected from the pre-dispatch sequence", async () => {
  const r = rig(); await r.monitor.dispatch(input);
  r.setLive({ agent_status: "done", state_change_seq: 42 }); await r.tick();
  assert.equal(r.events[0].state, "settled");
});

test("blocked, interrupted and stalled workers do not report success", async () => {
  for (const [change, expected] of [
    [{ agent_status: "blocked", state_change_seq: 41 }, "blocked"],
    [{ agent_session: { value: "some-other-session" }, state_change_seq: 41 }, "interrupted"],
    [{ agent_status: "unknown", state_change_seq: 41 }, "uncertain"],
  ]) {
    const r = rig(); await r.monitor.dispatch(input); r.setLive(change); await r.tick();
    assert.equal(r.events[0].state, expected);
  }
  const stalled = rig(); await stalled.monitor.dispatch(input); stalled.advance(30_001); await stalled.tick();
  assert.equal(stalled.events[0].state, "uncertain");
});

test("refuses wrong identity or busy worker before sending a prompt", async () => {
  for (const change of [{ cwd: "C:/other" }, { agent_status: "working" }]) {
    const r = rig(); r.setLive(change);
    await assert.rejects(r.monitor.dispatch(input), /identity or readiness/);
    assert.equal(r.commands.length, 1);
  }
});

test("publishes a follow-up in the main Pi conversation without claiming success", () => {
  const messages = [];
  publishFeedbackToPi({ sendMessage: (...args) => messages.push(args) }, { ...input, state: "settled" });
  assert.equal(messages.length, 1);
  assert.equal(messages[0][0].customType, "megagem-feedback");
  assert.match(messages[0][0].content, /NOT proof the task succeeded/);
  assert.deepEqual(messages[0][1], { triggerTurn: true, deliverAs: "followUp" });
});

test("does not dispatch a second prompt to a still-monitored pane", async () => {
  const r = rig(); await r.monitor.dispatch(input);
  await assert.rejects(r.monitor.dispatch(input), /already being monitored/);
  assert.equal(r.commands.filter(c => c[1] === "prompt").length, 1);
});

test("restores pending watches after reload and does not repeat delivered feedback", async () => {
  const r = rig(); await r.monitor.dispatch(input);
  const pending = r.stored[0];
  r.monitor.stop();
  r.setLive({ agent_status: "done", state_change_seq: 42 });
  r.monitor.restore([pending]); await r.tick();
  assert.equal(r.events.length, 1);
  r.monitor.restore(r.stored); assert.equal(r.timers.length, 0);
});
