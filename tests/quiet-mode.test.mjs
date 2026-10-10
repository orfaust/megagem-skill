import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { createQuietMode, createQuietToolRenderer, parseQuietArgument } from "../extensions/quiet-mode.ts";

test("parses commands; bare command toggles and junk is rejected", () => {
  assert.deepEqual(["", "on", " OFF ", "status", "x"].map(parseQuietArgument), ["toggle", "on", "off", "status", undefined]);
});

test("off by default, persists only changes, restores last branch value", () => {
  const saved = [];
  const quiet = createQuietMode({ save: data => saved.push(data) });
  assert.equal(quiet.enabled, false);
  assert.equal(quiet.set(false), false);
  assert.equal(quiet.set(true), true);
  assert.equal(quiet.set(true), false);
  assert.deepEqual(saved, [{ enabled: true }]);
  quiet.restore([{ enabled: true }, { enabled: false }, { enabled: true }]);
  assert.equal(quiet.enabled, true);
  quiet.restore([]);
  assert.equal(quiet.enabled, false, "a session without entries starts with the default display");
});

test("off delegates unchanged; on hides calls and results but keeps a content-free error line", () => {
  const quiet = createQuietMode({ save() {} });
  const original = { renderShell: "default", renderCall: () => "call", renderResult: () => "result" };
  const resolve = createQuietToolRenderer(quiet);
  const renderers = resolve("bash", () => original);
  assert.equal(renderers.renderShell, "default");
  assert.equal(renderers.renderCall, original.renderCall);
  assert.equal(renderers.renderResult, original.renderResult);
  assert.equal(resolve("mcp_unknown", () => undefined), undefined, "unknown tools stay untouched while off");
  quiet.set(true);
  assert.equal(renderers.renderShell, "self", "existing rows follow the live flag");
  assert.deepEqual(renderers.renderCall({}, {}, {}).render(80), []);
  const theme = { fg: (_c, t) => `<${t}>` };
  assert.deepEqual(renderers.renderResult({ content: [{ type: "text", text: "SECRET=abc" }] }, {}, theme, { isError: false }).render(80), []);
  const line = renderers.renderResult({ content: [{ type: "text", text: "SECRET=abc" }] }, {}, theme, { isError: true }).render(200);
  assert.equal(line.length, 1);
  assert.ok(!line[0].includes("SECRET"));
  assert.deepEqual(renderers.renderResult({}, {}, theme, { isError: true, isPartial: true }).render(80), []);
  assert.ok(resolve("mcp_unknown", () => undefined), "unknown tools are hidden while on");
  quiet.set(false);
  assert.equal(renderers.renderCall, original.renderCall);
});

// Pi is a host dependency: locate it via PI_CODING_AGENT_DIR or the global npm prefix on Windows; skip if absent.
const piDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.APPDATA ?? "", "npm", "node_modules", "@earendil-works", "pi-coding-agent");
const piEntry = join(piDir, "dist", "index.js");

test("real Pi ToolExecutionComponent draws nothing in quiet mode and redraws when toggled", { skip: !existsSync(piEntry) && "Pi package not found (set PI_CODING_AGENT_DIR)" }, async () => {
  const pi = await import(pathToFileURL(piEntry).href);
  pi.initTheme("dark", false);
  const quiet = createQuietMode({ save() {} });
  const resolve = createQuietToolRenderer(quiet);
  const ui = { requestRender() {} };
  const def = resolve("bash", () => ({ renderShell: "default", renderCall: () => ({ render: () => ["$ ls"], invalidate() {} }), renderResult: () => ({ render: () => ["out"], invalidate() {} }) }));
  const row = new pi.ToolExecutionComponent("bash", "1", { command: "ls" }, {}, def, ui, process.cwd());
  row.updateResult({ content: [{ type: "text", text: "out" }], isError: false }, false);
  assert.ok(row.render(80).join("\n").includes("$ ls"));
  quiet.set(true); row.setExpanded(true); row.setExpanded(false);
  assert.deepEqual(row.render(80), []);
  quiet.set(false); row.setExpanded(true);
  assert.ok(row.render(80).join("\n").includes("out"));
});
