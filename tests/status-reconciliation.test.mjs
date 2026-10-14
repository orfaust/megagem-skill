import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

// Ledger CLI moved to the sibling megagem repository; fixtures still use temporary DB/CSV.
const script = join(import.meta.dirname, "..", "..", "megagem", "extensions", "data", "ledger.py");
const header = "timestamp_inizio,operazione_id,timestamp_fine,durata_min,session_id,agente,modello,thinking,descrizione,tipo,progetto,ambito,worker,esito,note\n";
function row(id, status, project = "megagem-skill", scope = "skills") {
  return ["2026-10-13 12:00", id, "", "", "s", "pi", "model", "medium", "work", "fix", project, scope, "coordinator", status, "none"].join(",") + "\n";
}
function fixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "megagem-reconcile-"));
  const csv = join(dir, "archive.csv"), db = join(dir, "ledger.sqlite3");
  const original = header + row("op-0001", "in-corso") + row("op-0002", "verificato") + row("op-0003", "bloccato", "other", "docs") + row("op-0004", "verificato", "other", "docs");
  writeFileSync(csv, original);
  const run = (...args) => {
    const call = spawnSync("python", [script, ...args, "--db", db, ...(args[0] === "reconcile" ? ["--csv", csv] : args[0] === "verify" ? ["--csv", csv] : [])], { encoding: "utf8" });
    return { ...call, json: call.status === 0 ? JSON.parse(call.stdout) : undefined };
  };
  try { fn({ run, db, csv, original }); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("DB-only status annotation changes recovery view, not archived tasks, CSV, queue or verification", () => fixture(({ run, db, csv, original }) => {
  assert.equal(run("rebuild", "--csv", csv).status, 0);
  assert.equal(run("migrate-status").status, 0);
  const before = readFileSync(db);
  assert.equal(run("status-list", "--project", "megagem-skill", "--scope", "skills").json.items[0].effective_status, "verificato");
  assert.equal(run("reconcile", "--task-id", "op-0001", "--status", "verificato", "--evidence", "op-0002", "--reason", "same work verified later").json.unchanged, false);
  const items = run("status-list", "--project", "megagem-skill", "--scope", "skills").json.items;
  assert.deepEqual(items.map(x => [x.task_id, x.archive_status, x.effective_status, x.evidence_task_id]),
    [["op-0002", "verificato", "verificato", null], ["op-0001", "in-corso", "verificato", "op-0002"]]);
  assert.equal(run("status-list", "--project", "other").json.items[1].effective_status, "bloccato", "ambiguous other project unchanged");
  assert.equal(run("queue-list").json.items.length, 0);
  assert.equal(run("verify").json.csv_tasks, 4);
  assert.equal(readFileSync(csv, "utf8"), original, "archive bytes unchanged");
  assert.notDeepEqual(readFileSync(db), before, "only the private DB is annotated");
  assert.equal(run("reconcile", "--task-id", "op-0001", "--status", "verificato", "--evidence", "op-0002", "--reason", "same work verified later").json.unchanged, true);
  assert.equal(readFileSync(csv, "utf8"), original);
}));

test("invalid or conflicting evidence fails closed; no partial annotations or archive mutation", () => fixture(({ run, csv, original }) => {
  assert.equal(run("rebuild", "--csv", csv).status, 0);
  assert.equal(run("migrate-status").status, 0);
  for (const [id, evidence] of [["op-0001", "op-0001"], ["op-0001", "op-0003"], ["op-0001", "op-0004"], ["op-0002", "op-0001"], ["op-9999", "op-0002"]])
    assert.equal(run("reconcile", "--task-id", id, "--status", "verificato", "--evidence", evidence, "--reason", "no proof").status, 1);
  assert.equal(run("reconcile", "--task-id", "op-0001", "--status", "verificato", "--evidence", "op-0002", "--reason", "").status, 1);
  assert.equal(run("status-list").json.items.find(x => x.task_id === "op-0001").effective_status, "in-corso");
  assert.equal(run("reconcile", "--task-id", "op-0001", "--status", "verificato", "--evidence", "op-0002", "--reason", "proof").status, 0);
  assert.equal(run("reconcile", "--task-id", "op-0001", "--status", "bloccato", "--evidence", "op-0002", "--reason", "conflict").status, 1);
  assert.equal(run("status-list").json.items.find(x => x.task_id === "op-0001").effective_status, "verificato");
  assert.equal(readFileSync(csv, "utf8"), original);
  assert.equal(run("verify").status, 0);
}));
