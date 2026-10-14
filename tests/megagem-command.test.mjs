import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import test from "node:test";
import { BEGIN_MARKER, END_MARKER, activationBlock, bundledSkillPath, registerMegagemCommand } from "../extensions/megagem-command.ts";

function fixture(fn, { loaded = true, hasUI = true, mode = "tui", confirm = true, skillPath = bundledSkillPath, loadedSkillPath = bundledSkillPath } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "megagem-init-"));
  const notices = [], registrations = [], dialogs = [];
  const pi = {
    registerCommand(name, options) { registrations.push(name); this.handler = options.handler; },
    getCommands() { return loaded ? [{ name: "skill:megagem", source: "skill", sourceInfo: { path: loadedSkillPath } }, { name: "megagem-provider", source: "extension" }] : [{ name: "megagem-provider", source: "extension" }]; },
  };
  const ctx = { cwd, mode, hasUI, ui: {
    notify: (text, type) => notices.push({ text, type }),
    confirm: async (title, message) => { dialogs.push({ title, message }); return typeof confirm === "function" ? confirm() : confirm; },
  } };
  registerMegagemCommand(pi, skillPath);
  const path = join(cwd, "AGENTS.md");
  const api = { pi, ctx, path, notices, registrations, dialogs, run: () => pi.handler("", ctx) };
  return Promise.resolve().then(() => fn(api)).finally(() => rmSync(cwd, { recursive: true, force: true }));
}

test("installed skill path follows this module location, not cwd or a user-machine constant", () => {
  assert.ok(isAbsolute(bundledSkillPath));
  assert.equal(resolve(bundledSkillPath), resolve(fileURLToPath(new URL("../skills/megagem/SKILL.md", import.meta.url))));
  assert.match(readFileSync(bundledSkillPath, "utf8"), /name: megagem/);
  const block = activationBlock(bundledSkillPath);
  assert.match(block, /megagem:.*taskman:/);
  assert.match(block, /names this project/);
  assert.match(block, /informational questions directly without dispatching workers/);
  assert.ok(block.includes(JSON.stringify(bundledSkillPath)));
  assert.equal(block.split(BEGIN_MARKER).length, 2);
  assert.equal(block.split(END_MARKER).length, 2);
});

test("creation requires explicit confirmation; declining leaves project untouched", async () => fixture(async ({ run, path, dialogs, notices }) => {
  await run();
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0].message, /create.*AGENTS\.md/);
  assert.throws(() => readFileSync(path));
  assert.match(notices.at(-1).text, /cancelled/);
}, { confirm: false }));

test("append requires explicit confirmation; declining preserves unrelated graphify instructions", async () => fixture(async ({ run, path, dialogs }) => {
  const original = "# Instructions\n- **graphify**: /graphify\n";
  writeFileSync(path, original);
  await run();
  assert.equal(dialogs.length, 1);
  assert.match(dialogs[0].message, /append to.*AGENTS\.md/);
  assert.equal(readFileSync(path, "utf8"), original);
}, { confirm: false }));

test("confirmed creation writes only the activation block; notification says NEXT session", async () => fixture(async ({ run, path, dialogs, notices }) => {
  await run();
  assert.equal(dialogs.length, 1);
  assert.equal(readFileSync(path, "utf8"), activationBlock(bundledSkillPath));
  assert.match(notices.at(-1).text, /NEXT session/);
}));

test("confirmed append preserves other instructions byte-for-byte and repeat is idempotent", async () => fixture(async ({ run, path, dialogs, notices }) => {
  const original = "# Existing\r\n- **graphify**: /graphify\r\n";
  writeFileSync(path, original);
  await run();
  const first = readFileSync(path, "utf8");
  assert.ok(first.startsWith(original));
  assert.equal(first.split(BEGIN_MARKER).length - 1, 1);
  assert.ok(first.includes(JSON.stringify(bundledSkillPath)));
  assert.match(notices.at(-1).text, /NEXT session/);
  await run();
  assert.equal(dialogs.length, 1, "no new prompt and no duplicate block when already initialized");
  assert.equal(readFileSync(path, "utf8"), first);
}));

test("missing skill fails visibly before confirmation, whether AGENTS.md exists or not", async () => {
  for (const existing of [false, true]) await fixture(async ({ run, path, notices, dialogs }) => {
    if (existing) writeFileSync(path, "unrelated\n");
    await run();
    assert.equal(dialogs.length, 0);
    assert.match(notices.at(-1).text, /skill unavailable/);
    if (existing) assert.equal(readFileSync(path, "utf8"), "unrelated\n");
    else assert.throws(() => readFileSync(path));
  }, { loaded: false });
});

test("different loaded skill installation cannot activate an unrelated package", async () => fixture(async ({ run, path, dialogs, notices }) => {
  await run();
  assert.deepEqual(dialogs, []);
  assert.match(notices.at(-1).text, /different installation/);
  assert.throws(() => readFileSync(path));
}, { loadedSkillPath: fileURLToPath(new URL("../README.md", import.meta.url)) }));

test("missing installed skill or noninteractive mode blocks without mutation", async () => {
  await fixture(async ({ run, path, notices, dialogs }) => {
    await run();
    assert.equal(dialogs.length, 0);
    assert.match(notices.at(-1).text, /installed skill file missing/);
    assert.throws(() => readFileSync(path));
  }, { skillPath: join(tmpdir(), "not-a-megagem-install", "SKILL.md") });
  await fixture(async ({ run, path, notices, dialogs }) => {
    await run();
    assert.equal(dialogs.length, 0);
    assert.match(notices.at(-1).text, /confirmation-capable UI/);
    assert.throws(() => readFileSync(path));
  }, { hasUI: false, mode: "print" });
});

test("concurrent external edit during confirmation blocks append instead of overwriting", async () => {
  let path;
  await fixture(async ({ run, path: target, notices }) => {
    path = target;
    writeFileSync(path, "original\n");
    await run();
    assert.equal(readFileSync(path, "utf8"), "changed by user\n");
    assert.match(notices.at(-1).text, /changed during confirmation/);
  }, { confirm: () => { writeFileSync(path, "changed by user\n"); return true; } });
});

test("incomplete markers and symlinks are not silently rewritten", async () => fixture(async ({ run, path, notices, dialogs }) => {
  writeFileSync(path, `${BEGIN_MARKER}\nUnfinished`);
  await run();
  assert.equal(dialogs.length, 0);
  assert.match(notices.at(-1).text, /incomplete or duplicate/);
}));

test("package registers only /megagem-init; Pi native /skill:megagem and /megagem-provider stay available", async () => fixture(async ({ pi, registrations }) => {
  assert.deepEqual(registrations, ["megagem-init"]);
  for (const name of ["megagem-add", "megeagem-add", "megagem"]) assert.ok(!registrations.includes(name));
  assert.ok(pi.getCommands().some(command => command.name === "skill:megagem" && command.source === "skill"));
  assert.ok(pi.getCommands().some(command => command.name === "megagem-provider"));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.ok(pkg.pi.extensions.includes("./extensions/megagem-command.ts"));
  assert.ok(pkg.pi.extensions.includes("./extensions/megagem-provider.ts"));
  assert.ok(pkg.pi.skills.includes("./skills/megagem"));
  const providerSource = readFileSync(new URL("../extensions/megagem-provider.ts", import.meta.url), "utf8");
  assert.match(providerSource, /registerCommand\("megagem-provider"/);
}));
