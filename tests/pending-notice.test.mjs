import assert from "node:assert/strict";
import test from "node:test";
import { createPendingNotices, createDeferredDelivery, isDismissKey, isEnterKey, PENDING_WIDGET_KEY } from "../extensions/pending-notice.ts";
import { noticeText } from "../extensions/banner-text.ts";

const job = (over = {}) => ({ id: "j1", state: "settled", agentName: "moequ-worker", workspaceLabel: "moequ", tabLabel: "worker", ...over });

function rig({ language = "en", editor = "" } = {}) {
  let widget;
  const published = [];
  const durable = [];
  const removed = [];
  const notices = createPendingNotices({
    ui: {
      setWidget: (key, content) => { widget = { key, content }; },
      getEditorText: () => editor,
    },
    render: (entry, lang) => noticeText(entry, lang),
    getLanguage: () => language,
    publish: entry => published.push(entry),
    sendDurable: message => durable.push(message),
    onRemove: entry => removed.push(entry),
  });
  return { notices, published, durable, removed, widget: () => widget };
}

test("(a) settle defers: no coordinator turn, a persistent banner is shown", () => {
  const r = rig();
  r.notices.deliver(job());
  assert.equal(r.published.length, 0, "no user-role turn on settle");
  assert.equal(r.notices.size, 1);
  const widget = r.widget();
  assert.equal(widget.key, PENDING_WIDGET_KEY);
  assert.match(widget.content[0], /moequ-worker \(moequ \/ worker\) finished \(settled\)\. Press Enter to see the result\./);
  assert.match(widget.content.at(-1), /Ctrl\+X/);
  assert.equal(r.durable.length, 1, "durable non-turn transcript trace");
  assert.equal(r.durable[0].customType, "megagem-feedback-pending");
  assert.equal(r.durable[0].display, true);
});

test("(b) Enter is consumed only with a pending notice and releases the turn", () => {
  const r = rig();
  r.notices.deliver(job());
  assert.deepEqual(r.notices.handleInput("\r"), { consume: true });
  assert.deepEqual(r.published.map(entry => entry.id), ["j1"]);
  assert.equal(r.notices.size, 0);
  assert.equal(r.widget().content, undefined, "banner cleared");
  assert.deepEqual(r.removed.map(entry => entry.id), ["j1"]);
});

test("(c) Enter falls through when there is no pending notice or the editor has text", () => {
  const empty = rig();
  assert.equal(empty.notices.handleInput("\r"), undefined);
  assert.equal(empty.published.length, 0);

  const typing = rig({ editor: "my own message" });
  typing.notices.deliver(job());
  assert.equal(typing.notices.handleInput("\r"), undefined, "user submit is left untouched");
  assert.equal(typing.published.length, 0);
  assert.equal(typing.notices.size, 1);
});

test("(d) the dismiss key clears the notice without waking the coordinator", () => {
  const r = rig();
  r.notices.deliver(job());
  assert.deepEqual(r.notices.handleInput("\x18"), { consume: true });
  assert.deepEqual(r.published, []);
  assert.equal(r.notices.size, 0);
  assert.equal(r.widget().content, undefined);
  assert.equal(r.durable.at(-1).customType, "megagem-feedback-dismissed");
});

test("multiple pending notices release together, oldest first", () => {
  const r = rig();
  r.notices.deliver(job({ id: "old" }));
  r.notices.deliver(job({ id: "new" }));
  assert.equal(r.widget().content.length, 3, "two lines plus the shared hint");
  r.notices.handleInput("\r");
  assert.deepEqual(r.published.map(entry => entry.id), ["old", "new"]);
});

test("(f) with no UI the delivery stays immediate and nothing is deferred", async () => {
  const immediate = [];
  const deferred = [];
  const delivery = createDeferredDelivery({
    notices: { deliver: entry => deferred.push(entry) },
    hasUI: () => false,
    publishImmediate: entry => immediate.push(entry),
    markDeferred: entry => deferred.push(`marked:${entry.id}`),
  });
  await delivery.deliver(job());
  assert.deepEqual(immediate.map(entry => entry.id), ["j1"]);
  assert.deepEqual(deferred, [], "no banner, no deferral without UI");
});

test("interactive delivery defers, marks, enriches and keeps dispatch order", async () => {
  const order = [];
  const delivery = createDeferredDelivery({
    notices: { deliver: entry => order.push(`deliver:${entry.id}:${entry.tabLabel}`) },
    hasUI: () => true,
    publishImmediate: entry => order.push(`immediate:${entry.id}`),
    markDeferred: entry => order.push(`mark:${entry.id}`),
    enrich: async entry => { await new Promise(resolve => setImmediate(resolve)); return { ...entry, tabLabel: "enriched" }; },
  });
  const first = delivery.deliver(job({ id: "a" }));
  const second = delivery.deliver(job({ id: "b" }));
  await Promise.all([first, second]);
  assert.deepEqual(order, ["mark:a", "mark:b", "deliver:a:enriched", "deliver:b:enriched"]);
});

test("key matcher: Enter and Ctrl+X only, modified Enter is untouched", () => {
  for (const data of ["\r", "\x1bOM", "\x1b[13u", "\x1b[13;1u"]) assert.equal(isEnterKey(data), true, data);
  for (const data of ["\n", "\x1b\r", "\x1b[13;2u", "\x1b[13;5u", "x", "\x1b"]) assert.equal(isEnterKey(data), false, data);
  for (const data of ["\x18", "\x1b[120;5u"]) assert.equal(isDismissKey(data), true, data);
  for (const data of ["x", "\x1bx", "\x1b[120u"]) assert.equal(isDismissKey(data), false, data);
});
