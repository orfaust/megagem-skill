import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFeedbackMonitor } from "../extensions/feedback-monitor.ts";
import { START_ENTRY, checkDispatchPolicy, checkLiveStartup, claudePreflight, parseClaudeStartup, parseStartup, selectRoute, startRecord, startupFor } from "../extensions/dispatch-policy.ts";

const candidate = { paneId: "w9:p1", tabId: "w9:t1", workspaceId: "w9", sessionId: "session-path-123",
  project: "C:/test/project", taskLabel: "fix-provider", prompt: "Patch routing" };
const live = { pane_id: candidate.paneId, tab_id: candidate.tabId, workspace_id: candidate.workspaceId,
  agent_session: { value: candidate.sessionId }, cwd: candidate.project, agent: "pi", agent_status: "idle",
  interactive_ready: true, state_change_seq: 2 };
const provenance = { ...candidate, agent: "pi", provider: "deepseek", model: "deepseek/deepseek-flash" };
const branch = [{ type: "custom", customType: START_ENTRY, data: provenance }];
const config = (providers = {}, agents = {}) => JSON.stringify({ version: 2, providers, agents });

async function rig(fn) {
  const dir = await mkdtemp(join(tmpdir(), "megagem-policy-"));
  const path = join(dir, "megagem-providers.json");
  const commands = [];
  const run = async args => { commands.push(args); return args[1] === "get" ? { result: { agent: live } } : { result: { type: "agent_prompted", agent: live } }; };
  const monitor = createFeedbackMonitor({ run, save() {}, publish() {}, schedule: () => 1, cancel() {},
    authorize: async (requested, actual) => {
      const record = startupFor(branch, requested);
      checkLiveStartup(actual, requested, record);
      await checkDispatchPolicy(record, { path, consent: requested.consent });
    } });
  try { await fn({ monitor, commands, path }); } finally { monitor.stop(); await rm(dir, { recursive: true, force: true }); }
}

const noPrompt = commands => assert.equal(commands.filter(args => args[1] === "prompt").length, 0);

test("Pi worker idle, DeepSeek becomes deny after startup: no Herdr prompt", async () => rig(async ({ monitor, path, commands }) => {
  await writeFile(path, config());
  await monitor.dispatch(candidate);
  assert.equal(commands.filter(args => args[1] === "prompt").length, 1);
  monitor.stop();
  commands.length = 0;
  await writeFile(path, config({ deepseek: "deny" }));
  await assert.rejects(monitor.dispatch(candidate), /provider deepseek=deny.*no prompt sent/);
  noPrompt(commands);
}));

test("reused worker with unverified codex provenance blocks before priority gate", async () => rig(async ({ monitor, commands, path }) => {
  branch[0].data = { ...provenance, agent: "codex", provider: "openai-codex", model: "openai-codex/gpt-5.5" };
  const old = live.agent; live.agent = "codex";
  try {
    await writeFile(path, config({}, { codex: "deny" }));
    await assert.rejects(monitor.dispatch(candidate), /provenance unknown.*no prompt sent/);
    noPrompt(commands);
  } finally { branch[0].data = provenance; live.agent = old; }
}));

test("unknown or conflicting provenance fails closed, never substitutes log/title", async () => rig(async ({ monitor, commands, path }) => {
  await writeFile(path, config());
  const previous = branch.splice(0);
  try { await assert.rejects(monitor.dispatch(candidate), /provenance unknown/); noPrompt(commands); }
  finally { branch.push(...previous); }
  assert.throws(() => parseStartup("pi", []), /exactly one explicit/);
  assert.throws(() => parseStartup("codex", ["--model", "openai-codex/gpt-5.5"]), /not verified/);
  assert.throws(() => startRecord({}, candidate, parseStartup("pi", ["--model", "deepseek/deepseek-flash"])), /uncertain/);
}));

test("explicit deny requires exact, verified one-task consent; allowed with it", async () => rig(async ({ monitor, path, commands }) => {
  await writeFile(path, config({ deepseek: "deny" }));
  await assert.rejects(monitor.dispatch(candidate), /explicitly confirm/);
  noPrompt(commands);
  await assert.rejects(monitor.dispatch({ ...candidate, consent: { authorized: true, model: provenance.model } }), /no prompt sent/);
  noPrompt(commands);
  const consent = { ...provenance, authorized: true };
  assert.equal((await monitor.dispatch({ ...candidate, consent })).state, "submitted");
  assert.equal(commands.filter(args => args[1] === "prompt").length, 1);
}));

test("corrupt config stops; missing preferences defaults to normal and allowed Pi dispatches", async () => rig(async ({ monitor, path, commands }) => {
  await writeFile(path, "{");
  await assert.rejects(monitor.dispatch(candidate), /preferences invalid/i);
  noPrompt(commands);
  await rm(path);
  assert.equal((await monitor.dispatch(candidate)).state, "submitted");
  assert.equal(commands.filter(args => args[1] === "prompt").length, 1);
}));

test("Claude diagnostic does not turn coordinator auth into worker provider provenance", async () => {
  const args = ["--model", "claude-sonnet-4-5", "--effort", "medium"];
  assert.deepEqual(parseClaudeStartup(args), { agent: "claude", model: "claude-sonnet-4-5", effort: "medium", provider: undefined });
  for (const invalid of [[], ["--model", "sonnet", "--effort", "medium"], ["--model", "claude-sonnet-4-5", "--effort", "medium", "--fallback-model", "opus"], ["--model", "claude-sonnet-4-5", "--effort", "medium", "--dangerously-skip-permissions"], ["--model", "claude-sonnet-4-5", "--effort", "invalid"]])
    assert.throws(() => parseClaudeStartup(invalid), /no worker started/);
  const local = { auth: { loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty" }, help: "--model <model> --effort <level>", herdrHelp: "pi claude codex", environment: {} };
  assert.equal(claudePreflight(local).ready, false);
  assert.match(claudePreflight(local).reason, /target-worker provider/);
  for (const changed of [{ auth: { loggedIn: false } }, { auth: { loggedIn: true, authMethod: "claude.ai", apiProvider: "unknown" } }, { help: "--model <model>" }, { herdrHelp: "pi codex" }, { environment: { CLAUDE_CODE_USE_BEDROCK: "1" } }])
    assert.equal(claudePreflight({ ...local, ...changed }).ready, false);
  await assert.rejects(checkDispatchPolicy({ ...candidate, agent: "claude", provider: "anthropic", model: "anthropic/claude-sonnet-4-5" }), /provenance unavailable/);
});

test("routing refuses silent Pi fallback when Claude high has unknown provider/auth", () => {
  const agents = [{ name: "pi", installed: true, supported: true }, { name: "claude", installed: true, supported: true }];
  const providers = ["openai-codex", "deepseek"];
  const config = { version: 2, agents: { claude: "high" }, providers: {} };
  assert.match(selectRoute({ agents, providers, config }).reason, /Preferred agent claude.*unknown provider\/auth\/model/);
  assert.match(selectRoute({ agents, providers, config, explicit: { agent: "claude" } }).reason, /no automatic substitute|unknown provider/);
  assert.equal(selectRoute({ agents, providers, config, explicit: { agent: "pi" } }).pair.agent, "pi");
  assert.match(selectRoute({ agents, providers, config, explicit: { provider: "openai-codex" } }).reason, /cannot be checked for claude/);
  assert.equal(selectRoute({ agents, providers, config: { ...config, agents: { claude: "deny" } } }).pair.agent, "pi");
  assert.equal(selectRoute({ agents: [{ name: "pi", installed: true, supported: true }, { name: "claude", installed: false, supported: true }], providers, config }).pair.agent, "pi");
});

test("known provider pairs use weaker priority, deterministic ties, explicit choice and deny", () => {
  const agents = [{ name: "claude", installed: true, supported: true }, { name: "pi", installed: true, supported: true }];
  const providers = ["openai-codex"];
  const verifiedProviders = { claude: ["anthropic"] };
  const config = { version: 2, agents: { claude: "high" }, providers: { anthropic: "normal" } };
  const route = selectRoute({ agents, providers, config, verifiedProviders });
  assert.equal(route.pair.priority, "normal", "high agent + normal provider = normal");
  assert.deepEqual(route.ranked.map(p => p.agent), ["claude", "pi"]);
  assert.equal(selectRoute({ agents, providers, config, verifiedProviders, explicit: { agent: "pi" } }).pair.agent, "pi");
  assert.match(selectRoute({ agents, providers, config, verifiedProviders, explicit: { provider: "absent" } }).reason, /unavailable/);
  const denied = { ...config, providers: { anthropic: "deny" } };
  assert.equal(selectRoute({ agents, providers, config: denied, verifiedProviders }).pair.agent, "pi");
  assert.match(selectRoute({ agents, providers, config: denied, verifiedProviders, explicit: { agent: "claude", provider: "anthropic" } }).reason, /one-task confirmation/);
  assert.match(selectRoute({ agents, providers, config, verifiedProviders, explicit: { agent: "claude", provider: "anthropic" } }).reason, /cannot be started/);
  assert.throws(() => selectRoute({ agents: undefined, providers, config }), /unreliable/);
});

test("record is tied to verified startup response and live worker agent/session", () => {
  const parsed = parseStartup("pi", ["--model", "openai-codex/gpt-5.5", "--thinking", "medium"]);
  const record = startRecord({ result: { type: "agent_started", agent: live } }, candidate, parsed);
  assert.equal(record.provider, "openai-codex");
  checkLiveStartup(live, candidate, { ...record, project: candidate.project });
  assert.throws(() => checkLiveStartup({ ...live, agent_session: { value: "new" } }, candidate, record), /identity changed/);
  assert.throws(() => startupFor([{ type: "custom", customType: START_ENTRY, data: { ...record, agent: "claude", provider: "anthropic", model: "anthropic/sonnet" } }], candidate), /provenance unknown/);
});
