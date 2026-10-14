import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { loadPreferences, savePreferences, updatePriority, priorityOf } from "../extensions/provider-priority.ts";

const piDir = process.env.PI_CODING_AGENT_DIR ?? join(process.env.APPDATA ?? "", "npm", "node_modules", "@earendil-works", "pi-coding-agent");
const piEntry = join(piDir, "dist", "index.js");

// Resolve the host-supplied pi-tui package through the installed Pi directory (no npm install).
test("real Pi TUI component handles arrows, wrap, scrolling, Esc and persisted changes", { skip: !existsSync(piEntry) && "Pi not found" }, async () => {
  const require = createRequire(pathToFileURL(piEntry));
  const tui = require("@earendil-works/pi-tui");
  const { createProviderTable } = await import("../extensions/provider-table.ts");
  const dir = await mkdtemp(join(tmpdir(), "megagem-provider-ui-"));
  const path = join(dir, "prefs.json");
  try {
    let paints = 0, closes = 0;
    let config = await loadPreferences(path);
    const component = createProviderTable({ keys: tui, tui: { requestRender: () => paints++ }, theme: { fg: (_color, text) => text }, done: () => closes++,
      providers: ["pi"], agents: [{ name: "pi", installed: true }, { name: "claude", installed: true }, { name: "aider", installed: false }], initial: config,
      save: async ({ kind, name }, priority) => { config = updatePriority(await loadPreferences(path), kind === "provider" ? ["pi"] : ["claude"], name, priority, kind); await savePreferences(config, path); return config; } });
    const tick = () => new Promise(resolve => setTimeout(resolve, 20));
    const press = async key => { component.handleInput(key); await tick(); };
    const keys = { up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C", escape: "\x1b" };
    assert.ok(component.render(18).every(line => tui.visibleWidth(line) <= 18), "narrow renders fit terminal width");
    const [description, help, header, firstRow] = component.render(100);
    assert.match(description, /^Megagem priorities: set the routing priority/);
    assert.match(help, /Up\/Down select.*Right\/Left cycle high → normal → low → deny.*saved immediately.*Esc closes/);
    assert.equal(header.trimEnd(), "  level   agent     provider", "exactly two leading spaces before level");
    assert.equal(header.indexOf("level"), firstRow.indexOf("normal"), "priority column aligns with selected row");
    assert.equal(header.indexOf("agent"), firstRow.indexOf("CLAUDE"), "agent column aligns with selected row");
    assert.equal(header.indexOf("provider"), firstRow.indexOf("—"), "provider column aligns with selected row");
    assert.doesNotMatch(component.render(100).join("\n"), /aider/);
    assert.doesNotMatch(component.render(100).join("\n"), /agent\s+pi\s/);
    assert.match(component.render(100).join("\n"), /▶ normal\s+CLAUDE\s+—/);
    await press(keys.left); // agent claude normal -> high
    assert.equal(priorityOf(await loadPreferences(path), "claude", "agent"), "high");
    await press(keys.left); // high -> deny (wrap), moves below provider pi
    assert.equal(priorityOf(await loadPreferences(path), "claude", "agent"), "deny");
    assert.equal(component.selected, 1);
    await press(keys.right); // deny -> high (wrap), moves ahead of provider pi
    assert.equal(priorityOf(await loadPreferences(path), "claude", "agent"), "high");
    assert.equal(component.selected, 0);
    await press(keys.down); // provider pi normal follows high agent claude
    assert.equal(component.selected, 1);
    await press(keys.down); // absent aider has no row
    assert.equal(component.selected, 1);
    await press(keys.left); // provider pi normal -> high; ties sort by exact name
    assert.equal(priorityOf(await loadPreferences(path), "pi"), "high");
    assert.equal(component.selected, 1);
    assert.equal(priorityOf(await loadPreferences(path), "aider", "agent"), "normal");
    component.handleInput(keys.escape);
    assert.equal(closes, 1);
    component.handleInput(keys.right);
    assert.equal(priorityOf(await loadPreferences(path), "claude", "agent"), "high");
    assert.ok(paints > 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("mixed priorities interleave, retain kind identity on reorder, and preserve cursor", { skip: !existsSync(piEntry) && "Pi not found" }, async () => {
  const { createProviderTable } = await import("../extensions/provider-table.ts");
  const keys = createRequire(pathToFileURL(piEntry))("@earendil-works/pi-tui");
  let config = { version: 2, providers: { alpha: "high", claude: "normal", omega: "low" }, agents: { claude: "high", beta: "normal", pi: "deny", aider: "deny" } };
  const table = createProviderTable({ keys, tui: { requestRender() {} }, theme: { fg: (_c, s) => s }, done() {},
    providers: ["omega", "claude", "alpha"], agents: [{ name: "pi", installed: true }, { name: "aider", installed: false }, { name: "beta", installed: true }, { name: "claude", installed: true }], initial: config,
    save: async ({ kind, name }, priority) => { config = updatePriority(config, kind === "agent" ? ["claude", "beta"] : ["omega", "claude", "alpha"], name, priority, kind); return config; },
  });
  const press = async key => { table.handleInput(key); await new Promise(resolve => setTimeout(resolve, 8)); };
  const visible = () => table.render(100).filter(line => /^[▶ ] (high|normal|low|deny)\s/.test(line)).map(line => line.trim());
  assert.deepEqual(visible().map(line => line.match(/(?:high|normal|low|deny)\s+(PI|CLAUDE|BETA)\s+(\S+)/).slice(1)), [
    ["PI", "alpha"], ["CLAUDE", "—"], ["BETA", "—"], ["PI", "claude"], ["PI", "omega"],
  ]);
  assert.doesNotMatch(table.render(100).join("\n"), /agent\s+pi\s|aider/);
  await press("\x1b[B"); // agent claude high
  await press("\x1b[C"); // agent claude normal; moves behind beta, stays selected
  assert.equal(table.selected, 2);
  assert.match(table.render(100).join("\n"), /▶ normal\s+CLAUDE\s+—/);
  await press("\x1b[C"); // agent claude low; moves behind provider claude, stays selected
  assert.equal(table.selected, 3);
  assert.match(table.render(100).join("\n"), /▶ low\s+CLAUDE\s+—/);
  assert.deepEqual(visible().map(line => line.match(/(?:high|normal|low|deny)\s+(PI|CLAUDE|BETA)\s+(\S+)/).slice(1)), [
    ["PI", "alpha"], ["BETA", "—"], ["PI", "claude"], ["CLAUDE", "—"], ["PI", "omega"],
  ]);
  assert.equal(priorityOf(config, "claude"), "normal", "same-name provider preference unchanged");
  assert.equal(priorityOf(config, "claude", "agent"), "low");
});

test("absent-only inventory has no agent rows even when a saved deny exists", { skip: !existsSync(piEntry) && "Pi not found" }, async () => {
  const { createProviderTable } = await import("../extensions/provider-table.ts");
  const keys = createRequire(pathToFileURL(piEntry))("@earendil-works/pi-tui");
  let writes = 0;
  const table = createProviderTable({ keys, tui: { requestRender() {} }, theme: { fg: (_c, s) => s }, done() {}, providers: [], agents: [{ name: "aider", installed: false }, { name: "pi", installed: true }], initial: { version: 2, providers: {}, agents: { aider: "deny", pi: "deny" } }, save: () => { writes++; } });
  assert.match(table.render(100).join("\n"), /No providers or agents found/);
  table.handleInput("\x1b[C");
  assert.equal(writes, 0);
  assert.doesNotMatch(table.render(100).join("\n"), /aider|agent pi/);
});

test("arrows re-sort after save and keep identity, including scrolling; failed save does not reorder", { skip: !existsSync(piEntry) && "Pi not found" }, async () => {
  const { createProviderTable } = await import("../extensions/provider-table.ts");
  const keys = createRequire(pathToFileURL(piEntry))("@earendil-works/pi-tui");
  const config = { version: 2, providers: { z: "high", a: "deny" }, agents: { pi: "deny" } };
  let changed = config;
  let fail = false;
  const table = createProviderTable({ keys, tui: { requestRender() {} }, theme: { fg: (_c, s) => s }, done() {},
    providers: ["a", "z", "b"], agents: [{ name: "pi", installed: true }], initial: config,
    save: async ({ name }, priority) => {
      if (fail) throw new Error("cannot save");
      changed = updatePriority(changed, ["a", "z", "b"], name, priority);
      return changed;
    },
  });
  const press = async key => { table.handleInput(key); await new Promise(resolve => setTimeout(resolve, 8)); };
  const names = () => table.render(100).filter(line => /^[▶ ] (high|normal|low|deny)\s/.test(line)).map(line => line.match(/\sPI\s+(\S+)/)?.[1]).filter(Boolean);
  assert.deepEqual(names(), ["z", "b", "a"]);
  await press("\x1b[B"); // b normal
  await press("\x1b[D"); // b high, moves before z; keep b selected
  assert.equal(table.selected, 0);
  assert.match(table.render(100).join("\n"), /▶ high\s+PI\s+b/);
  assert.deepEqual(names(), ["b", "z", "a"]);
  await press("\x1b[B"); // z high
  fail = true;
  await press("\x1b[C"); // error, no sorting and still high
  assert.deepEqual(names(), ["b", "z", "a"]);
  assert.equal(table.selected, 1);
  assert.match(table.feedback, /Not saved.*cannot save/);
  // More than 12 rows: selected identity must remain visible when it moves to bottom.
  const many = Array.from({ length: 17 }, (_, i) => `p${String(i).padStart(2, "0")}`);
  let snapshot = { version: 2, providers: {}, agents: {} };
  const long = createProviderTable({ keys, tui: { requestRender() {} }, theme: { fg: (_c, s) => s }, done() {}, providers: many, agents: [], initial: snapshot,
    save: async ({ name }, priority) => { snapshot = updatePriority(snapshot, many, name, priority); return snapshot; } });
  long.handleInput("\x1b[D"); // first normal -> high, then high -> deny
  await new Promise(resolve => setTimeout(resolve, 8));
  long.handleInput("\x1b[D");
  await new Promise(resolve => setTimeout(resolve, 8));
  assert.equal(long.selected, 16);
  assert.match(long.render(100).join("\n"), /▶ deny\s+PI\s+p00/);
  assert.equal(long.render(100).length, 16, "two help lines, header, twelve visible rows and save feedback");
});

test("failed write is visible, not claimed saved, and original file unchanged", { skip: !existsSync(piEntry) && "Pi not found" }, async () => {
  const { createProviderTable } = await import("../extensions/provider-table.ts");
  const tui = createRequire(pathToFileURL(piEntry))("@earendil-works/pi-tui");
  const component = createProviderTable({ keys: tui, tui: { requestRender() {} }, theme: { fg: (_c, s) => s }, done() {}, providers: ["pi"], agents: [], initial: { version: 2, providers: {}, agents: {} }, save: async () => { throw new Error("disk full"); } });
  component.handleInput("\x1b[C");
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.match(component.feedback, /Not saved.*disk full/);
  assert.match(component.render(80).join("\n"), /▶ normal\s+PI\s+pi/);
});
