import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createProviderCommand } from "../extensions/megagem-provider.ts";
import { discoverAgents, CODING_AGENTS, DISPLAY_AGENTS } from "../extensions/agent-discovery.ts";
import { formatAgentList, formatPriorityList, formatProviderList, listProviders, loadPreferences, parseProviderArgs, priorityOf, providerStorePath, routingCandidates, routingPairs, savePreferences, sortPriorityRows, updatePriority, visiblePriorityRows } from "../extensions/provider-priority.ts";

const registry = (names, error) => ({ getError: () => error, getAvailable: () => names.map(provider => ({ provider, id: "chat" })) });
const withStore = async fn => { const dir = await mkdtemp(join(tmpdir(), "megagem-provider-")); try { await fn(join(dir, "prefs.json")); } finally { await rm(dir, { recursive: true, force: true }); } };
const agents = [{ name: "pi", installed: true }, { name: "claude", installed: true }, { name: "aider", installed: false }];
const fake = (names, { hasUI = false, mode = "print", showTable } = {}) => {
  const notices = [];
  return { notices, ctx: { modelRegistry: registry(names), hasUI, mode, ui: { notify: (text, type) => notices.push([text, type]) } }, showTable };
};
const command = path => createProviderCommand({ path, discover: async () => agents });

test("provider inventory comes from authenticated chat snapshot and errors fail closed", () => {
  assert.deepEqual(listProviders(registry(["zeta", "alpha", "zeta"])), ["alpha", "zeta"]);
  assert.throws(() => listProviders(registry(["alpha"], "broken catalog")), /catalog unavailable/);
  assert.throws(() => listProviders({ getAvailable: () => undefined, getError: () => undefined }), /list unavailable/);
});

test("agent discovery checks PATH and Windows PATHEXT without executing CLIs", async () => {
  const seen = [];
  const found = await discoverAgents({ env: { PATH: "C:\\Tools;C:\\Other", PATHEXT: ".EXE;.CMD" }, platform: "win32", inspect: async file => { seen.push(file); return file.endsWith("pi.cmd") || file.endsWith("claude.EXE"); } });
  assert.equal(found.find(x => x.name === "pi").installed, true);
  assert.equal(found.find(x => x.name === "claude").installed, true);
  assert.equal(found.find(x => x.name === "aider").installed, false);
  assert.ok(seen.some(x => x.endsWith("codex.exe")));
  assert.deepEqual(found.map(x => x.name), CODING_AGENTS);
  assert.equal(DISPLAY_AGENTS.length, 12);
  assert.equal(new Set(DISPLAY_AGENTS).size, DISPLAY_AGENTS.length);
  assert.ok(!DISPLAY_AGENTS.includes("pi"));
  await assert.rejects(discoverAgents({ env: {}, inspect: async () => false }), /PATH unavailable/);
  await assert.rejects(discoverAgents({ env: { PATH: "/usr/bin" }, platform: "linux", inspect: async () => { throw new Error("filesystem failure"); } }), /filesystem failure/);
});

test("v1 migration preserves providers exactly, adds separate agent map only when saved", async () => withStore(async path => {
  const old = '{"version":1,"providers":{"deepseek":"low","LM Studio":"deny"}}';
  await writeFile(path, old);
  assert.deepEqual(await loadPreferences(path), { version: 2, providers: { deepseek: "low", "LM Studio": "deny" }, agents: {} });
  assert.equal(await readFile(path, "utf8"), old, "read/status must never mutate v1");
  await savePreferences(updatePriority(await loadPreferences(path), ["pi"], "pi", "high", "agent"), path);
  assert.deepEqual(await loadPreferences(path), { version: 2, providers: { deepseek: "low", "LM Studio": "deny" }, agents: { pi: "high" } });
}));

test("default, independent namespaces and deny on either side; absent agents excluded", () => {
  const config = { version: 2, providers: { pi: "low", z: "deny", a: "high" }, agents: { pi: "high", claude: "deny" } };
  assert.equal(priorityOf(config, "pi"), "low");
  assert.equal(priorityOf(config, "pi", "agent"), "high");
  assert.equal(priorityOf(config, "missing", "agent"), "normal");
  assert.deepEqual(routingCandidates(["pi", "z", "a"], config), ["a", "pi"]);
  assert.deepEqual(routingCandidates(["pi", "claude"], config, "agent"), ["pi"]);
  assert.deepEqual(routingPairs(agents, ["pi", "z", "a"], config), [{ agent: "pi", provider: "a", priority: "high" }, { agent: "pi", provider: "pi", priority: "low" }]);
  assert.deepEqual(routingPairs(agents, ["z"], config), []);
  assert.deepEqual(routingPairs([{ name: "aider", installed: false }], ["a"], config), []);
  assert.deepEqual(routingPairs([{ name: "pi", installed: true }], ["a"], { ...config, agents: { pi: "deny" } }), [], "hidden Pi deny must still block routing");
});

test("parse legacy aliases and explicit agent/provider commands; reject invalid syntax", () => {
  assert.deepEqual(parseProviderArgs(""), { action: "list" });
  assert.deepEqual(parseProviderArgs("set a deny"), { action: "set", kind: "provider", name: "a", priority: "deny" });
  assert.deepEqual(parseProviderArgs("set agent pi high"), { action: "set", kind: "agent", name: "pi", priority: "high" });
  assert.deepEqual(parseProviderArgs("reset provider pi"), { action: "reset", kind: "provider", name: "pi" });
  assert.deepEqual(parseProviderArgs("reset a"), { action: "reset", kind: "provider", name: "a" });
  for (const bad of ["set a max", "set agent a max", "reset agent", "set a", "status extra", "set a deny extra"]) assert.equal(parseProviderArgs(bad), undefined);
  const config = { version: 2, providers: {}, agents: {} };
  assert.throws(() => updatePriority(config, ["pi"], "absent", "high", "agent"), /not available/);
  assert.throws(() => updatePriority(config, ["pi"], "pi", "max", "agent"), /Invalid priority/);
  assert.deepEqual(updatePriority(updatePriority(config, ["pi"], "pi", "deny", "agent"), ["pi"], "pi", "normal", "agent"), config);
});

test("persist across sessions, retain stale entries and use isolated agent directory", async () => withStore(async path => {
  const missing = await loadPreferences(path);
  assert.equal(priorityOf(missing, "alpha"), "normal");
  await savePreferences(updatePriority(missing, ["alpha"], "alpha", "deny"), path);
  assert.equal(priorityOf(await loadPreferences(path), "alpha"), "deny");
  assert.deepEqual(routingCandidates(["beta"], await loadPreferences(path)), ["beta"]);
  assert.equal(providerStorePath({ PI_CODING_AGENT_DIR: join(tmpdir(), "isolated-test") }), join(tmpdir(), "isolated-test", "megagem-providers.json"));
}));

test("invalid or unreadable configuration never overwritten", async () => withStore(async path => {
  for (const bad of ["{", "[]", '{"version":1,"providers":{"a":"max"}}', '{"version":2,"providers":{},"agents":{"pi":"max"}}', '{"version":9,"providers":{}}']) {
    await writeFile(path, bad);
    const { notices, ctx } = fake(["a"]);
    await command(path)("set agent pi high", ctx);
    assert.match(notices.at(-1)[0], /not changed/);
    assert.equal(await readFile(path, "utf8"), bad);
  }
}));

test("command fallback lists both kinds, isolates updates, rejects absent CLI/inventory failure", async () => withStore(async path => {
  const { notices, ctx } = fake(["pi", "alpha"]);
  const run = command(path);
  await run("", ctx);
  assert.match(notices[0][0], /provider alpha: normal/);
  assert.match(notices[0][0], /agent claude: normal \(installed\)/);
  assert.doesNotMatch(notices[0][0], /aider:/);
  assert.doesNotMatch(notices[0][0], /Absent agents are hidden|Priorities \(/);
  assert.doesNotMatch(notices[0][0], /\nagent pi:/);
  assert.match(notices[0][0], /Pi agent priority: normal/);
  await run("set pi low", ctx);
  await run("set agent pi high", ctx);
  await run("status", ctx);
  assert.match(notices.at(-1)[0], /Pi agent priority: high/);
  assert.doesNotMatch(notices.at(-1)[0], /\nagent pi:/);
  assert.equal(priorityOf(await loadPreferences(path), "pi"), "low");
  assert.equal(priorityOf(await loadPreferences(path), "pi", "agent"), "high");
  await run("set agent aider deny", ctx);
  assert.equal(priorityOf(await loadPreferences(path), "aider", "agent"), "normal");
  await run("set agent pi deny", ctx);
  assert.deepEqual(routingPairs([{ name: "pi", installed: true }], ["pi"], await loadPreferences(path)), []);
  await run("reset agent pi", ctx);
  assert.equal(priorityOf(await loadPreferences(path), "pi", "agent"), "normal");
  ctx.modelRegistry = registry(["pi"], "catalog error");
  await run("set agent pi deny", ctx);
  assert.equal(priorityOf(await loadPreferences(path), "pi", "agent"), "normal");
  const broken = createProviderCommand({ path, discover: async () => { throw new Error("inventory failure"); } });
  ctx.modelRegistry = registry(["pi"]);
  await broken("set pi high", ctx);
  assert.match(notices.at(-1)[0], /inventory failure/);
  assert.equal(priorityOf(await loadPreferences(path), "pi"), "low");
}));

test("TUI receives a real save callback and preserves values when cancelled", async () => withStore(async path => {
  const { ctx } = fake(["pi"], { hasUI: true, mode: "tui" });
  const run = createProviderCommand({ path, discover: async () => agents, showTable: async ({ providers, agents: listed, initial, save }) => {
    assert.deepEqual(providers, ["pi"]);
    assert.deepEqual(listed, [{ name: "claude", installed: true }]);
    assert.equal(priorityOf(initial, "pi"), "normal");
    await save({ kind: "agent", name: "claude" }, "deny");
  } });
  await run("", ctx);
  assert.equal(priorityOf(await loadPreferences(path), "claude", "agent"), "deny");
}));

test("status priority ordering is stable across kinds, pi hidden only in agents", () => {
  const config = { version: 2, providers: { low: "low", high: "high", deny: "deny" }, agents: { pi: "deny", cline: "low", codex: "high", amp: "deny" } };
  assert.deepEqual(sortPriorityRows(["z", "high", "deny", "low", "a"].map(name => ({ kind: "provider", name })), config).map(row => row.name), ["high", "a", "z", "low", "deny"]);
  assert.deepEqual(formatProviderList(["low", "z", "high", "deny", "a"], config).split("\n"), ["high: high", "a: normal", "z: normal", "low: low", "deny: deny"]);
  assert.deepEqual(formatAgentList(["amp", "pi", "cline", "codex", "aider"].map(name => ({ name, installed: name !== "cline" && name !== "aider" })), config).split("\n").map(line => line.split(":")[0]), ["codex", "amp"]);
  assert.equal(priorityOf(config, "pi", "agent"), "deny");
  const mixed = { version: 2, providers: { beta: "low", same: "normal", zeta: "high" }, agents: { claude: "high", same: "normal", aider: "deny", pi: "high" } };
  const discovered = [{ name: "pi", installed: true }, { name: "aider", installed: true }, { name: "same", installed: true }, { name: "claude", installed: true }, { name: "absent", installed: false }];
  const rows = visiblePriorityRows(["same", "beta", "zeta"], discovered, mixed);
  assert.deepEqual(rows.map(({ kind, name }) => `${kind} ${name}`), ["agent claude", "provider zeta", "agent same", "provider same", "provider beta", "agent aider"]);
  assert.deepEqual(formatPriorityList(["same", "beta", "zeta"], discovered, mixed).split("\n"), [
    "agent claude: high (installed)", "provider zeta: high", "agent same: normal (installed)",
    "provider same: normal", "provider beta: low", "agent aider: deny (installed)",
  ]);
  assert.deepEqual(visiblePriorityRows(["same", "beta", "zeta"], discovered, mixed), rows, "deterministic ties");
});

test("absent agent priorities are retained, but status excludes absent rows and CLI rejects edit", async () => withStore(async path => {
  const saved = { version: 2, providers: { alpha: "low" }, agents: { aider: "deny", pi: "deny", claude: "high" } };
  await savePreferences(saved, path);
  const before = await readFile(path, "utf8");
  const { ctx, notices } = fake(["alpha"]);
  const run = command(path);
  await run("status", ctx);
  assert.doesNotMatch(notices.at(-1)[0], /aider:/);
  assert.match(notices.at(-1)[0], /agent claude: high \(installed\)/);
  assert.match(notices.at(-1)[0], /Pi agent priority: deny/);
  await run("set agent aider normal", ctx);
  assert.match(notices.at(-1)[0], /not currently available/);
  assert.equal(await readFile(path, "utf8"), before);
  assert.equal(priorityOf(await loadPreferences(path), "aider", "agent"), "deny");
  assert.deepEqual(routingPairs([{ name: "pi", installed: true }], ["alpha"], await loadPreferences(path)), []);
}));

test("skill guard: deny both, explicit choices, unsupported agents and language", () => {
  const skill = readFileSync(new URL("../skills/megagem/SKILL.md", import.meta.url), "utf8");
  for (const expected of [/Before routing or starting any \*\*new\*\* worker/, /"version": 2/, /Legacy v1/, /saved agent AND provider priorities/, /if either is `deny`/, /all supported installed agents are denied/, /Herdr-supported/, /never infer one from its name/, /agents\.pi = deny/, /herdr agent start --help/, /explicit choice: explain the conflict and ask confirmation/, /## Reply language/, /Translate only the leading phrase/]) assert.match(skill, expected);
});
