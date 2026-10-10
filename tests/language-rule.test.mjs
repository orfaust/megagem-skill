import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const skill = read("skills/megagem/SKILL.md");
const readme = read("README.md");
const sources = ["extensions/megagem-feedback.ts", "extensions/feedback-monitor.ts", "extensions/feedback-guard.ts", "extensions/megagem-quiet.ts", "extensions/quiet-mode.ts"].map(read);

// <leading phrase> <workspace>/<tab> — <agent> <model>, <thinking label> <level>, all on one line.
const assignmentLine = /^\S.* \S+\/\S+ — (pi|claude|codex) \S+, (thinking|effort|reasoning) \S+$/;
// Natural-language reference forms for particular languages must not creep back in: the rule is generic.
const languageCatalogue = /\b(compito assegnato|tarea asignada|tâche assignée|Aufgabe zugewiesen|conpito|laoro assegnà)\b|\b(Italian|Spanish|French|German|Veneto)\b/;

test("the skill states one generic rule: every reply follows the user's language, whatever it is", () => {
  const rule = /## Reply language[\s\S]*?(?=\n## )/.exec(skill)?.[0] ?? "";
  assert.match(rule, /language of the user's request, whatever that language or variant is/);
  assert.match(rule, /regional languages and dialects/);
  assert.match(rule, /assignment line, status, verified results, blockers, questions/);
  assert.match(rule, /never reply in it just because the notice is English/);
  assert.doesNotMatch(rule, languageCatalogue, "no per-language catalogue or special case");
});

test("ambiguity fallback, one-line discipline and untranslated parts are preserved", () => {
  assert.match(skill, /mixed languages, or a request with no identifiable language/);
  assert.match(skill, /most recent earlier user message that has one; if there is none, use English/);
  assert.match(skill, /exactly one plain-text line per successful task/);
  assert.match(skill, /Never translate `<workspace>`\/`<tab name>`/);
  assert.match(skill, /\*\*Never translated:\*\*/);
  assert.match(skill, /No status, estimates, links, ledger, explanations, reasons or extra instructions/);
});

test("the assignment line carries agent, model and thinking level, with rules for unverified values", () => {
  assert.match(skill, /`task assigned to <workspace>\/<tab name> — <agent> <model>, <thinking label> <level>`/);
  assert.match(skill, /live `agent` value Herdr reports/);
  assert.match(skill, /exactly the identifiers Megagem passed/);
  assert.match(skill, /`thinking` for Pi, `effort` for Claude, `reasoning` for Codex/);
  assert.match(skill, /do not invent it/);
  assert.match(skill, /`model unverified`/);
  assert.match(skill, /Herdr does not expose model or thinking level/);
  assert.match(skill, /needs no extra parameters/);
});

test("README states the same generic rule and shows only the English single-line example", () => {
  const blocks = [...readme.matchAll(/```text\r?\n([^\r\n]+)\r?\n```/g)].map(match => match[1]).filter(line => line.includes(" — "));
  assert.deepEqual(blocks, ["task assigned to api/login — claude sonnet, effort medium"]);
  assert.match(blocks[0], assignmentLine);
  assert.match(readme, /Every reply follows the language you write in, whatever that language or variant is, including regional languages and dialects/);
  assert.match(readme, /otherwise English/);
  assert.match(readme, /codex model unverified, reasoning unverified/);
  assert.match(readme, /Herdr does not expose them/);
  // Only the example's own text and the test-case description may mention a leading phrase; no other languages.
  assert.doesNotMatch(readme, languageCatalogue);
  assert.doesNotMatch(readme, /compito assegnato/i);
});

test("the English example's labels and details sit after the translatable phrase only", () => {
  const [phrase, details] = "task assigned to api/login — claude sonnet, effort medium".split(" — ");
  assert.match(phrase, /^task assigned to \S+\/\S+$/);
  assert.match(details, /^(pi|claude|codex) \S+, (thinking|effort|reasoning) \S+$/);
  assert.match(readme, /Only the leading phrase is translated/);
});

test("the dispatch tool contract is unchanged: agent/model/thinking are not tool parameters", () => {
  const tool = sources[0];
  assert.doesNotMatch(tool, /\b(model|thinking|agent): Type\./);
  for (const field of ["paneId", "tabId", "workspaceId", "sessionId", "project", "taskLabel", "prompt"]) assert.match(tool, new RegExp(`${field}: Type\.String`));
});

test("extension code has no hard-coded natural-language reply; machine identifiers stay fixed", () => {
  for (const source of sources) assert.doesNotMatch(source, languageCatalogue);
  for (const source of sources) assert.doesNotMatch(source, /\bstato\b/i);
  assert.match(sources[2], /\[Megagem automatic worker notification - not typed by the user\] /);
  assert.match(sources[1], /feedbackId/);
});
