# Megagem

> **FROZEN / RETIRED — 2026-10-14.** This repository is the Megagem prototype. Its successor is the private [`orfaust/megagem`](https://github.com/orfaust/megagem) repository at `C:\Users\carlorfeo\Documents\projects\megagem\megagem`. The successor holds the specification (`SPEC.md`), in-progress service code (`src/`), Pi extension package (`extensions/`, `skills/`), and central operations ledger (`operations_log.csv` + `data/megagem.sqlite3`). This repository is kept only as history and as a rollback target for the Pi package pointer; it is no longer edited. Nothing operational remains here: the ledger and database were moved out, and `data/` is empty. The material below is preserved as prototype documentation.

A Pi skill plus a companion Pi extension that coordinate coding workers in Herdr. You keep talking to the **main Pi chat**; Pi hands bounded tasks to visible worker tabs (Pi, Claude or Codex), replies at once, and comes back with a verified result when the worker settles. You can give Pi new instructions while workers run, and you can open or intervene in any worker tab.

## Requirements

- Herdr CLI and a running Herdr server. Start Pi **inside a Herdr pane** (`HERDR_ENV=1`); Megagem refuses to touch Herdr from outside it.
- Pi, plus any worker CLI you want to use (Pi, Claude or Codex), installed and authenticated.
- Installing creates no workspaces and starts no workers; that only happens when you ask.

## Install

```bash
pi install npm:pi-megagem        # or add -l for a project-local install
```

For development, install from a local checkout instead: `pi install .` (from the repository root).

Run `/reload` in a running Pi session to load `/megagem-init` and automatic feedback. The native `/skill:megagem` command works without the extension.

## Use

```text
/megagem-init
# start a NEW Pi session in this project
megagem: implement the login and verify the tests
# alternatively: /skill:megagem In C:\path\to\project, implement the login and verify the tests
```

`/megagem-init` asks for confirmation **before** creating or appending a delimited Megagem block to `AGENTS.md` in Pi's current project directory; refusal changes nothing. Existing instructions remain in place, and running it again does not duplicate the block. The block points to the installed skill by the extension's resolved absolute path. It is read from the **next session**, not activated retroactively in the current one. If the skill is unavailable, or Pi cannot ask for confirmation, the command reports a blocker without writing. On a request naming this project or using an explicit `megagem:` / `taskman:` prefix, Pi reads those skill rules and coordinates the task in this main chat; it answers informational questions without dispatch. You can also invoke the native `/skill:megagem <request>` directly. Pi finds or creates the project's workspace only for a task that requires delegation, dispatches **without waiting**, and answers with one line per successfully assigned task:

```text
task assigned to api/login — claude sonnet, effort medium
```

- `api/login` are the real Herdr workspace/tab labels; `claude sonnet, effort medium` are the agent, model and thinking level used for that task.
- Only the leading phrase is translated. Labels, agent, model identifiers and the thinking term (`thinking` for Pi, `effort` for Claude, `reasoning` for Codex) never are.
- Herdr does not expose model or thinking level, so Pi prints what it actually passed at startup. If that cannot be verified the line says so (for example `codex model unverified, reasoning unverified`) instead of guessing.
- **Every reply follows the language you write in, whatever that language or variant is, including regional languages and dialects.** If it is ambiguous (mixed languages or no identifiable language), Pi uses your most recent earlier message, otherwise English.

The assignment is not a completion claim. Edits are always delegated to a worker; Pi inspects and verifies but does not implement files itself, never approves worker prompts or bypasses permissions, and never closes your tabs. Conflicting edits are serialized in one worker; independent tasks get separate tabs. Recurring work on the same `progetto` + `ambito` reuses a dedicated worker tab and session. If you intervene in a worker tab, automation for it pauses until you say you are done. The full rules live in [`skills/megagem/SKILL.md`](skills/megagem/SKILL.md).

## Automatic feedback

When a worker dispatched by Megagem settles or blocks, the extension **immediately** delivers a user-role follow-up in interactive Pi and RPC/print/JSON. Pi checks live Herdr state, worker output, files and tests and reports the **verified** result or blocker in the main chat. No Enter, banner or dismissal key is required. A settled state alone is never proof of success.

If Pi answers that event with nothing visible, the extension reminds it once; if that fails too, you get a warning plus a saved alert saying the result is **not verified**. Closing Pi stops monitoring; reopening the session restores pending watches.

## Quiet mode

`/quiet-mode [on|off|status]` (no argument toggles) hides all tool calls and outputs in the Pi chat so you read only the conversation. It is **off by default**, applies immediately, and survives `/reload` and resume. It changes drawing only: tools still run, approvals and the session history are untouched; tool timing lines (`Elapsed`/`Took`) are hidden with their blocks and a failed tool still shows one line (without output or timing). Not hidden: `!` shell commands, thinking blocks (Ctrl+T), the startup header, images in tool results, Pi notifications, **and third-party custom transcript entries**, including TIMELINE/ASSISTANT/TOOL timestamps from `@narumitw/pi-stamp` v0.53.0. Pi exposes `registerEntryRenderer` per entry type, but no `next()`/entry-renderer resolver or cross-extension filter. Its host selects the **first** renderer registered for a type in extension load order, and `pi-stamp` loads first in the current settings. Megagem cannot wrap its renderer while preserving the stamp's off-state or dynamically hide already-mounted entries through a supported API. This requires Pi to expose a composable entry-renderer resolver/filter, or an upstream opt-in event in pi-stamp; Megagem does not override or modify another package or its settings.

## Provider and agent priorities

`/megagem-provider` lists authenticated **chat providers** from the running coordinator Pi's model registry and a curated catalogue of **at most 12 visible coding-agent CLIs** on its PATH. The agent `pi` is omitted from the visible agent list because Pi providers already appear, **not** removed from routing. Providers and installed agents share one list, globally sorted `high → normal → low → deny`; ties use exact name, then kind (`agent` before `provider`) when names match. Each row identifies its kind. Only **installed** non-Pi agents appear in TUI and status; absent agents and their saved preferences stay on disk, are not selectable and are never automatic routing candidates. In TUI, use **Up/Down** to select a row; **Right** cycles `high → normal → low → deny → high`, **Left** reverses and wraps. Each successful save immediately re-sorts the whole list and keeps the cursor on the **same provider/agent**, adjusting scroll; on failure no reorder occurs and the error is shown. **Esc** closes the screen. In interactive mode the command opens only a compact `level  agent  provider` table (no explanatory notification); an agent row without verified provider mapping shows `—` rather than inventing a provider. Save errors stay visible in the table. In RPC/print/JSON, status remains a concise sorted list with Pi agent priority:; status requires no interactive table:

```text
/megagem-provider status
/megagem-provider set deepseek low         # legacy provider alias
/megagem-provider set provider deepseek deny
/megagem-provider reset deepseek           # legacy provider alias
/megagem-provider set agent claude high
/megagem-provider reset agent claude
/megagem-provider set agent pi deny         # Pi's separate, hidden agent priority
/megagem-provider reset agent pi
```

Only exact currently available names and one of the four priorities can be edited. A `normal` setting or `reset` removes the override, restoring the default `normal`. The shared cross-project preferences file is in the coordinator's Pi agent directory (`~/.pi/agent/megagem-providers.json`, or `PI_CODING_AGENT_DIR/megagem-providers.json`), **not** Pi settings or credentials. Schema v2 is `{ "version": 2, "providers": {}, "agents": {} }`: each map stores only non-default priorities. An existing v1 `{ "version": 1, "providers": { ... } }` is read without changing the file; the first intentional edit upgrades to v2 **without discarding any provider entry**. A missing file means all `normal`. Disappeared providers and agents keep their saved values for later return; absent agents are completely omitted from TUI/status but cannot be edited or automatically chosen. Invalid/unreadable configuration or an unreliable inventory fails closed; no preferences are changed automatically. No login or token lookup occurs.

The `pi` agent priority is reported separately in status, even though its agent row is hidden from both status list and TUI; use `set/reset agent pi` to change it. A saved `agents.pi = deny` **still blocks automatic Pi routing**, regardless of provider priority. The UI never rewrites existing Pi, provider or other agent preferences just to hide a row. A provider named `pi` is a separate key, not the Pi agent.

For a **new** automatic worker route: explicit user choices take precedence, then other stated preferences, then saved agent **and** provider priorities. For a verified pair, its priority is the weaker of the two; either `deny` excludes it from automatic selection. Denied explicit choices require confirmation, never silent substitution. All eligible agents denied, or all applicable verified providers denied: stop and ask. Reuse of an existing denied worker requires consent for a new task. **Each dispatch re-reads the current preference file** after worker readiness/identity verification and just before sending the prompt; this includes idle reused workers started before a provider became `deny`. A denied agent **or** provider blocks without sending. Neither the operations log nor a tab/title proves a model. Running tasks are not stopped or switched retroactively. The installed Herdr `agent start --help` checked 2026-10-12 recognizes Pi, Claude, Codex, Gemini, Cursor, OpenCode, Copilot, Cline, Amp, Kiro, Qwen and Kilo among its kinds. Aider remains informational: it is **not** a recognized Herdr kind. A displayed kind is never automatically startable just because it is listed: check current Herdr help, local CLI readiness, its native model flags and worker authentication before dispatch. Pi's provider inventory **does not establish the provider or authentication** used by Claude/Codex or another Pi worker. If a non-Pi worker's provider cannot be verified, ask before treating it as compliant with provider restrictions. CLI installation does **not** prove auth or model usability; verify in the target worker environment before starting. These preferences do not change running workers, report credit balances, set spending limits or guarantee endpoint access.

**Routing guard:** `megagem_route` re-reads preferences and inventories to return a ranked, deterministic decision: the weaker agent/provider priority wins, and explicit agent/provider requests cannot silently substitute. Pi chat providers are sourced from the coordinator registry. Claude CLI installation, Herdr support and `claude auth status` (`loggedIn: true`) do **not** prove a worker-side provider, selected model, supported native flags, or dispatch authorization. Until there is independent trusted provider/worker provenance, Claude has an unknown provider: when a preferred installed Claude could outrank Pi, the tool blocks and asks rather than silently starting Pi. `megagem_claude_preflight` can check local Claude `--model`/`--effort` flags, Herdr kind and sanitized local `auth status` (never returns raw credentials); it validates a full model ID and refuses fallback or permission-bypass startup flags. It always returns **not ready**: local results cannot attest provider/model/auth for the target pane, and Herdr does not expose them. It neither starts Claude nor creates provenance. A future trusted target-worker attestation is required; do not treat `firstParty` as a provider identifier. This is a bounded fail-closed improvement, **not** working Claude dispatch support. `megagem_start` and automatic `megagem_dispatch` recheck ranking and preferences, even for idle reused sessions; choosing another route requires an explicit user decision. The inventory of Herdr-supported kinds, target CLI authentication and model suitability still needs live verification; PATH alone is insufficient. Explicit one-task deny consent remains separate from the routing decision.

**Dispatch guard and recovery:** The installed extension offers `megagem_start` for new Pi workers (explicit `--model provider/model`, checked before startup), then `megagem_dispatch` verifies the startup record against live Herdr pane/tab/workspace/session/cwd/agent and checks both fresh priorities before every prompt. Its startup record comes only from a successful tool-controlled start and a following live `agent get`; model/provider come from flags passed to that start, **not** from Herdr (which does not expose model) or a CSV row. Old workers without such provenance fail closed; start a fresh allowed worker. If a deny is encountered the tool records the conflict without sending; after the user subsequently confirms the exact agent, provider, model and task, `megagem_consent` can issue a one-use ticket for that worker/task/prompt. Explicit confirmation outranks saved deny only for that task, never as a persistent override. Missing preferences mean `normal`; malformed/unreadable preferences block. The native `/skill:megagem` fallback works without the extension but **cannot enforce the guard in code**: follow its manual verification steps and stop when provenance is missing. `/megagem-provider` keeps its UI; `/megagem-init` only writes AGENTS.md after confirmation and never dispatches. Run `/reload` after updating the installed extension before attempting any new dispatch.

Limitations: a Pi session can change its model outside Megagem or a user can edit the preference file between the final read and the Herdr prompt; Herdr does not expose a reliable current model and there is no atomic transaction with its prompt API. Stop/reconcile if there is observable intervention; the guard minimizes but cannot eliminate this TOCTOU window. Existing session records from other coordinators are not accepted merely because their names match. Direct `herdr agent prompt` outside the skill/tool bypasses this guard. Non-Pi provider identity is unknown without independent trusted startup provenance; the tool intentionally does not route them. No preferences are modified by dispatch. A denied explicit choice at **new-worker startup** is rejected by `megagem_start` (which has no startup exception ticket): the user can instead choose an allowed worker or explicitly change their own priority; it is not silently overridden.

Catalogue sources consulted **2026-10-12** (official documentation/project pages and live `herdr agent start --help`; deliberately curated, **not** a popularity ranking): [Pi](https://pi.dev/), [Claude Code](https://code.claude.com/docs/en/overview), [Codex CLI](https://developers.openai.com/codex/cli), [Gemini CLI](https://github.com/google-gemini/gemini-cli), [OpenCode](https://opencode.ai/docs/), [Cursor](https://cursor.com/docs), [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/overview), [Cline](https://docs.cline.bot/usage/cli-overview), [Amp](https://ampcode.com/docs), [Kiro](https://kiro.dev/docs/cli/), [Qwen Code](https://github.com/QwenLM/qwen-code), [Kilo](https://kilo.ai/docs), [Aider](https://aider.chat/docs/). Discovery catalogue (up to 12 non-Pi entries): `claude`, `codex`, `gemini`, `opencode`, `cursor`, `copilot`, `cline`, `amp`, `kiro`, `qwen`, `kilo`, `aider`. Only those installed on the active Pi process PATH are displayed. Pi is discovered for routing but omitted from the list. Local PATH check on the developer Windows/Git Bash environment on that date: `pi`, `claude`, `codex`, `copilot`, `qwen` found; `gemini`, `opencode`, `cursor`, `cline`, `amp`, `kiro`, `kilo`, `aider` absent. PATH presence does not prove that a matching CLI is usable or authenticated; especially `copilot` and `qwen` were not executed or identity-checked beyond the executable lookup. The command repeats lookup from **its own running Pi process PATH**, so results can differ on another machine/session. After installing/updating, run `/reload`.

## Operations log

The ledger has moved to the sibling **megagem** repository: `megagem/data/megagem.sqlite3` is the private central system of record and `megagem/operations_log.csv` is its append-only archive (never delete or rewrite old rows). The database, its journals and private backups under `megagem/data/` are git-ignored; the CSV is tracked in the private megagem repository. This `megagem-skill` package remains the current coordinator until the explicit cutover, but is being retired as an archive. Taskman reads the central DB's archived `tasks.status`; `status-list` provides the effective status.

Use the stdlib-only ledger entry point in the sibling `megagem` checkout. Run these commands from `megagem-skill` (or remove `../megagem/` from paths when inside `megagem`):

```text
python ../megagem/extensions/data/ledger.py verify
python ../megagem/extensions/data/ledger.py migrate-queue  # one-time additive queue schema migration
python ../megagem/extensions/data/ledger.py queue-list      # persistent pending/blocked/running/failed work
python ../megagem/extensions/data/ledger.py migrate-status  # one-time DB-only status annotation schema
python ../megagem/extensions/data/ledger.py status-list --project megagem-skill --scope skills
python ../megagem/extensions/data/ledger.py reconcile --task-id op-0045 --status verificato --evidence op-0064 --reason 'Repo rule and test verified; see log'  # inspect evidence first
python ../megagem/extensions/data/ledger.py append --row-json '["YYYY-MM-DD HH:MM","op-NEXT",...15 CSV strings...]'
python ../megagem/extensions/data/ledger.py sync     # only if CSV is ahead after a failed DB write
python ../megagem/extensions/data/ledger.py rebuild --db ../megagem/data/rebuilt.sqlite3 --csv ../megagem/operations_log.csv
```

`queue-create --description '...' --project '...' --scope '...' [--depends-on ID]` records durable pending work. `queue-claim --id ID --worker-session-id SESSION` requires a verified `done` dependency, and `queue-complete --id ID` is only for a running task whose result was actually verified. `queue-fail`/`queue-block` require `--reason`; `queue-list` shows claimability, not permission to dispatch automatically. Queue creation does not submit a prompt or bypass the user's continuation rule.

**Historical status reconciliation:** `tasks.status` remains the archived CSV value, never rewritten. A DB-only `status_reconciliations` table stores the original/effective status, later verified task ID and a nonempty reason. `status-list` joins it to show both statuses and the evidence for session-recovery decisions; `queue-list` lists separate queued work, not archived task statuses. The status view is the explicit ledger CLI; raw SQLite and Taskman's existing reader still show archived `tasks.status`. `reconcile` requires a later verified operation in the same project, a valid new status and a reason; equal repeats are idempotent, conflicting edits fail closed. An evidence ID alone is not proof of the same work: inspect the later log entry and repository before invoking it. `verify`, `append`, `sync` and `migrate` continue comparing original immutable task tuples with the CSV. **No CSV row changes**; a rebuild from the CSV alone loses these DB-only annotations (and messages): preserve a SQLite backup and reapply vetted annotations if restoring. Taskman's unmodified read path still displays archived `tasks.status`, not these effective statuses. This does not claim to update Taskman's UI or to close unverified live work.

`append` takes all 15 fields in the CSV header order, verifies DB/CSV equality, allocates only `max(op-NNNN)+1`, appends CSV and inserts SQLite under a DB write lock. It fails closed on mismatch; never use a manual CSV-only append as a fallback. Rebuild creates a **new** DB and restores archived tasks, preserving IDs and source row numbers. The CSV contains **no messages**; preserve a SQLite backup for any future messages, because rebuilding from CSV alone cannot recover them.

Schema (one row per operation, columns in this exact order):

```text
timestamp_inizio,operazione_id,timestamp_fine,durata_min,session_id,agente,modello,thinking,descrizione,tipo,progetto,ambito,worker,esito,note
```

- `timestamp_inizio` / `timestamp_fine`: local time, `YYYY-MM-DD HH:MM`; `timestamp_fine` is
empty while the operation is not concluded. `durata_min` is derived from the two timestamps
(integer minutes) and must not contradict them.
- `operazione_id`: unique progressive id `op-0001`, `op-0002`, …; never reused. Together with
`session_id`, `timestamp_inizio` and `timestamp_fine` it links the row to the start and end
messages of that operation in the session.
- `session_id`: the id of the **worker** session that performed the task, **not** the
coordinator session (the coordinator session id is used only for operations the coordinator
did itself). This is the correction to the earlier flat file, where every row carried the
coordinator id.
- `agente`: the agent type, `pi`, `claude` or `codex`; `pi` for the coordinator.
- `modello` / `thinking`: filled only when the worker was started with explicit flags
(`pi --model <id> --thinking <level>`, `claude --model <id> --effort <level>`); otherwise
`non-verificato`. Herdr does not expose model or thinking level, so they cannot be inferred:
either they are passed, or the field says `non-verificato`. Never invent them.
- `descrizione`: one line, short; if it contains commas or quotes it must be quoted as proper CSV.
- `tipo`: `analisi`, `implementazione`, `fix`, `riorganizzazione`, `documentazione`, `ricerca`,
`visualizzazione`, `operativita`, `verifica`, `indagine`.
- `progetto`: `moequ`, `megagem-skill` or `sistema`. `sistema` is the project for tasks that
belong to no repository — Pi, an agent CLI, Herdr, the shell, the environment or the operating
system. It is already in use (`op-0001`…`op-0003`, `ambito = shell`).
- `ambito`: the part of the project worked on — a short, reusable, stable kebab-case slug (for
example `exp02`, `quant-sim`, `log`). Reuse the existing name for the same part; do not invent
synonyms. If an operation touches several parts, record the dominant one. Always filled, never
empty. Current repertoire:

| `progetto` | `ambito` values in use |
|---|---|
| `moequ` | `exp01`, `exp02`, `exp03`, `quant-sim`, `schemi`, `documentazione`, `download`, `orchestrazione` |
| `megagem-skill` | `extensions`, `skills`, `tests`, `log`, `docs`, `provider`, `quiet-mode`, `db-centrale` |
| `sistema` | `shell`, `tooling`, `pi`, `herdr` |
- `worker`: `coordinatore` or the worker name with its pane (for example `moequ-chunk (w1C:p5)`);
the pane distinguishes workers that shared one session id.
- `esito`: `verificato`, `fallito`, `interrotto`, `in-corso`, `bloccato`. Negative outcomes are
recorded too, they are the most informative part.
- `note`: caveats, blockers and things not verified.

Update convention: **append rows at the end**, never rewrite existing rows; the next id is `max(op-NNNN)+1`, never reused. Use the central ledger CLI above, not direct CSV editing. A DB failure after CSV append leaves the archive ahead: stop, report, run `sync` explicitly and `verify` before assigning another ID. Recording is a step of the Megagem skill itself (see *Delegate and supervise* in [`skills/megagem/SKILL.md`](skills/megagem/SKILL.md)), not a separate task.

`modello` convention: for the **past** rows it reports the name the CLI shows
(`DeepSeek V4.1 Flash`), reconstructed from configuration and the pane status line;
`DeepSeek V4.1 Flash` corresponds to the `deepseek/deepseek-flash` identifier. For **new** rows,
record the identifier actually passed to `--model` (for example `deepseek/deepseek-flash`).

`thinking: off` for the past rows comes from `defaultThinkingLevel` in
`~/.pi/agent/settings.json`, with no flag passed: it is a configuration fact, not an inference.

The row with `agente = claude` keeps `modello`/`thinking` at `non-verificato`: those values are
unrecoverable from any verified source.

The log also drives **session recovery**: before creating a new worker or session, the skill
consults the central SQLite ledger (with `../megagem/operations_log.csv` as backup) for the **same `progetto` and `ambito`** and prefers recovering an
earlier session that worked on that pair (best candidates: `in-corso`, then `fallito` /
`interrotto`). The log only narrows the candidates; it does not decide — live Herdr verification
remains the authority.

For **recurring work** the skill keeps one **dedicated worker tab per `progetto` + `ambito`**
pair: the tab label recalls the `ambito` (not necessarily the exact slug) and later compatible
tasks reuse the same tab and worker session, preserving context. Before creating a tab or a
session it looks up a candidate for the **same `progetto` AND the same `ambito`** and then
verifies the live Herdr identity, `cwd`, state and session. It never creates a tab just to make
names match, never renames or closes your tabs, and never reuses another ambito's tab just
because it is idle; a long or degraded session, an incompatible model/thinking, or an
interrupted/unsafe worker forces a new session or tab. A label or a log row alone never
guarantees recovery. See *Choose execution and dependencies* in
[`skills/megagem/SKILL.md`](skills/megagem/SKILL.md).

Accuracy note: the timestamps of past operations are **reconstructed** and approximate to the
minute.

The file is **not published** in the npm package: `package.json`'s `files` field lists only
`skills`, `extensions` and `README.md` (verified).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "requires a Herdr-managed Pi pane" | Start Pi from a Herdr pane (`HERDR_ENV=1`). |
| No automatic message after a worker finishes | Only the skill is loaded: install the package and `/reload`. |
| Updated an older install and old behavior persists | Restart Pi once; `/reload` does not refresh previously loaded `.mjs` helpers. |
| `/quiet-mode` missing | `extensions/megagem-quiet.ts` is not loaded; check `pi list`. |
| `/megagem-provider` missing | `extensions/megagem-provider.ts` is not loaded; run `/reload` and check `pi list`. |
| `/megagem-init` missing | Load `extensions/megagem-command.ts` with the package and run `/reload`; `/skill:megagem` works without initialization. |
| Extension notices are in English | The `[Megagem automatic …]` event and alerts are English; Pi's reply follows the user's request language. |

## Development

```bash
node --test tests/*.test.mjs
```

The tests are deterministic: startup-provenance and live deny enforcement (including reuse, missing/corrupt preferences, explicit one-task exception), confirmed AGENTS.md initialization (create, append, refuse, idempotence, missing skill; no live Herdr smoke test), provider/agent display and persistence, monitor and dispatch logic, the empty-reply guard, immediate completion feedback in every mode and the persistent dependency queue, quiet-mode parsing/rendering (using Pi's real `ToolExecutionComponent` when Pi is found via `PI_CODING_AGENT_DIR` or the global npm prefix) and the language/assignment-format rules. They do not exercise a real worker or live Herdr.

Layout: `skills/megagem/SKILL.md` (workflow), `extensions/megagem-feedback.ts` (dispatch tool, monitor, guard, delivery), `extensions/pending-notice.ts` (immediate feedback delivery), `../megagem/extensions/data/ledger.py` (CSV/SQLite ledger and persistent queue in the sibling checkout), `extensions/megagem-quiet.ts` (quiet mode), `extensions/megagem-command.ts` (confirmed AGENTS.md initialization), `extensions/megagem-provider.ts` / `extensions/provider-priority.ts` / `extensions/agent-discovery.ts` / `extensions/provider-table.ts` (provider and agent preferences), `tests/`. Maintainer notes and the manual verification scenarios (run only in an isolated Herdr session, never on live workspaces) are in [`AGENTS.md`](AGENTS.md).
