import assert from "node:assert/strict";
import test from "node:test";
import { detectLanguage, hasLanguage, noticeText, resolveLanguage } from "../extensions/banner-text.ts";

test("(g) explicit setting wins over detection and unknown codes fall through", () => {
  assert.equal(resolveLanguage({ explicit: "it", lastUserText: "hello please" }), "it");
  assert.equal(resolveLanguage({ explicit: "it-IT", lastUserText: "hello please" }), "it");
  assert.equal(resolveLanguage({ explicit: "IT", lastUserText: "hello please" }), "it");
  assert.equal(resolveLanguage({ explicit: "xx", lastUserText: "puoi fare questo grazie" }), "it", "unknown explicit code degrades to detection");
  assert.equal(hasLanguage("it"), true);
  assert.equal(hasLanguage("xx"), false);
});

test("(g) detection picks a supported language or degrades to neutral English", () => {
  assert.equal(detectLanguage("Ciao, puoi fare questo? Grazie"), "it");
  assert.equal(detectLanguage("Hello, can you please do this? Thanks"), "en");
  assert.equal(detectLanguage("Hallo, wenn du das noch machen kannst, danke"), "de");
  assert.equal(detectLanguage("path/to/file"), undefined);
  assert.equal(detectLanguage(""), undefined);
  assert.equal(resolveLanguage({}), "en", "neutral fallback");
  assert.equal(resolveLanguage({ lastUserText: "path/to/file" }), "en");
});

test("the notice carries agent, workspace/tab labels and the raw state; the language is localized", () => {
  const job = { state: "settled", agentName: "moequ-worker", workspaceLabel: "moequ", tabLabel: "worker" };
  assert.equal(
    noticeText(job, "it").line,
    "Task dell'agente moequ-worker (moequ / worker) terminato (settled). Premi Invio per vedere il risultato.",
  );
  assert.match(noticeText(job, "it").dismiss, /Ctrl\+X/);
  assert.equal(
    noticeText(job, "en").line,
    "Worker agent moequ-worker (moequ / worker) finished (settled). Press Enter to see the result.",
  );
});

test("unknown language or missing labels degrade to neutral text and IDs, never a broken string", () => {
  const unknown = noticeText({ state: "blocked", agentName: "a", workspaceId: "w1", tabId: "w1:t1" }, "zz");
  assert.equal(unknown.line, "Worker agent a (w1 / w1:t1) blocked (blocked). Press Enter to see the result.");
  const missing = noticeText({ state: "monitor_error" }, "en");
  assert.match(missing.line, /agent unverified/);
  assert.match(missing.line, /monitor error \(monitor_error\)/);
});
