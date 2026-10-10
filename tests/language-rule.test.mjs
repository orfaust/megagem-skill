import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const skill = read("skills/megagem/SKILL.md");
const readme = read("README.md");
const sources = ["extensions/megagem-feedback.ts", "extensions/feedback-monitor.ts", "extensions/feedback-guard.ts", "extensions/megagem-quiet.ts", "extensions/quiet-mode.ts"].map(read);

// <leading phrase> <workspace>/<tab> — <agent> <model>, <thinking label> <level>, all on one line.
const assignmentLine = /^\S.* \S+\/\S+ — (pi|claude|codex) \S+, (thinking|effort|reasoning) \S+$/;

test("the skill makes every reply, including the assignment line, follow the user's language", () => {
  assert.match(skill, /## Reply language/);
  assert.match(skill, /language of the user's current request/);
  assert.match(skill, /most recent earlier user message/);
  assert.match(skill, /if there is none, use English/);
  assert.match(skill, /exactly one plain-text line per successful task/);
  assert.match(skill, /Never translate `<workspace>`\/`<tab name>`/);
  assert.doesNotMatch(skill, /: `compito assegnato a <workspace>\/<tab name>`\. Replace/, "no hard-coded Italian reply rule");
});

test("the assignment line carries agent, model and thinking level, with rules for unverified values", () => {
  assert.match(skill, /`task assigned to <workspace>\/<tab name> — <agent> <model>, <thinking label> <level>`/);
  assert.match(skill, /task assigned to megagem-skill\/quiet-mode — claude sonnet, effort medium/);
  assert.match(skill, /live `agent` value Herdr reports/);
  assert.match(skill, /exactly the identifiers Megagem passed/);
  assert.match(skill, /`thinking` for Pi, `effort` for Claude, `reasoning` for Codex/);
  assert.match(skill, /do not invent it/);
  assert.match(skill, /`model unverified`/);
  assert.match(skill, /Herdr does not expose model or thinking level/);
  assert.match(skill, /needs no extra parameters/);
  assert.match(skill, /never translated/i);
  // The one-line / no-extra-text rules must not be weakened.
  assert.match(skill, /No status, estimates, links, ledger, explanations, reasons or extra instructions/);
});

test("the documented examples are single lines in the required format; translation changes only the leading phrase", () => {
  const english = /```text\r?\n(task assigned to [^\r\n]+)\r?\n```/.exec(readme)?.[1];
  assert.equal(english, "task assigned to api/login — claude sonnet, effort medium");
  assert.match(english, assignmentLine);
  const italian = /`(compito assegnato a [^`\r\n]+)`/.exec(readme)?.[1];
  const spanish = /`(tarea asignada a [^`\r\n]+)`/.exec(readme)?.[1];
  for (const line of [italian, spanish]) {
    assert.match(line, assignmentLine);
    assert.equal(line.split(" — ")[1], english.split(" — ")[1], "details after the dash are not translated");
    assert.equal(line.split(" — ")[0].split(" ").at(-1), "api/login", "labels are not translated");
  }
  const veneto = /`(conpito assegnà a [^`\r\n]+)`/.exec(readme)?.[1];
  assert.equal(veneto, "conpito assegnà a api/login — claude sonnet, effort medium");
  assert.match(veneto, assignmentLine);
  assert.equal(veneto.split(" — ")[1], english.split(" — ")[1]);
  assert.notEqual(veneto.split(" — ")[0], italian.split(" — ")[0], "Veneto reply differs from the Italian one");
  assert.match(readme, /codex model unverified, reasoning unverified/);
  assert.match(readme, /Herdr does not expose them/);
  assert.match(readme, /translated into the language of your request/);
  assert.match(readme, /otherwise English/);
  assert.doesNotMatch(readme, /exactly `compito assegnato/);
});

test("Veneto is an explicit supported language with markers, one-line discipline and an Italian boundary", () => {
  const rule = /\*\*Veneto is a supported user language\*\*[^\r\n]+/.exec(skill)?.[0] ?? "";
  for (const marker of ["dighe de far el commit", "te capisi", "vecio", "ndemo"]) assert.ok(rule.includes(marker), marker);
  assert.match(rule, /answered in Veneto, not standard Italian/);
  assert.match(rule, /plain Italian with no Veneto markers, answer in Italian/);
  assert.match(rule, /labels, agent, model identifiers and the thinking term stay/);
  assert.match(skill, /Veneto `conpito assegnà a <workspace>\/<tab name>`/);
  assert.match(skill, /genuinely mixed languages/);
  assert.match(readme, /treated as real languages \(not as ambiguous Italian\)/);
});

test("the dispatch tool contract is unchanged: agent/model/thinking are not tool parameters", () => {
  const tool = sources[0];
  assert.doesNotMatch(tool, /\b(model|thinking|agent): Type\./);
  for (const field of ["paneId", "tabId", "workspaceId", "sessionId", "project", "taskLabel", "prompt"]) assert.match(tool, new RegExp(`${field}: Type\\.String`));
});

test("extension code has no hard-coded Italian reply; machine identifiers stay fixed", () => {
  for (const source of sources) assert.doesNotMatch(source, /compito assegnato|tarea asignada|\bstato\b/i);
  assert.match(sources[2], /\[Megagem automatic worker notification - not typed by the user\] /);
  assert.match(sources[1], /feedbackId/);
});
