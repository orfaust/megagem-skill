# Megagem

A Pi skill and companion Pi extension that coordinate coding workers in Herdr. The **main Pi conversation** remains the user's point of contact. Pi assigns bounded tasks to visible worker tabs (Pi, Claude or Codex) and **returns immediately after dispatch**. When a Megagem-dispatched worker settles, the extension wakes Pi to verify the result and reply in the main chat; you can give Pi another instruction while the worker runs. You can still open and intervene in worker tabs.

## Prerequisites

- Herdr CLI and a compatible running Herdr server; **start Pi inside a Herdr-managed pane** (`HERDR_ENV=1`). Megagem stops rather than manipulating a Herdr session from outside it.
- Pi with the Agent Skills command enabled. Install and authenticate any worker CLI you want Megagem to use; Herdr supports more agents, but this initial skill routes only Pi, Claude and Codex.
- Review the skill before installation. Installing it does not create workspaces or start workers; those actions happen only on an explicit request.

## Install for Pi

From this repository, run `pi install ./` (or `pi install ./ -l` for a project-local installation). Pi loads `skills/megagem/SKILL.md`, `extensions/megagem-feedback.ts` and `extensions/megagem-quiet.ts` via `package.json`. Run `/reload` in an existing Pi session to pick up changes. For a one-off run, start Pi with `pi --skill ./skills/megagem --extension ./extensions/megagem-feedback.ts` from this repository. Loading only the skill retains manual `/skill:megagem status` checks but **not** automatic feedback.

Invoke explicitly:

```text
/skill:megagem In C:\path\to\project, implement the login and verify the tests
```

`/skill:megagem` is Pi's built-in explicit skill invocation. There is **no `/megagem` command or Pi extension in this MVP**: a normal message beginning with “megagem” is not a guaranteed trigger. If an alias becomes necessary, add a thin Pi adapter later; keep coordination rules in the skill so other hosts can reuse them with their own installation and command integration. Claude or Codex acting as a **worker** does not require Claude/Codex to install this skill. Making either a **coordinator** is separate future work.

## Behavior

1. Resolve the project from an explicit path, otherwise the coordinator's current project directory; ask if ambiguous. Check `HERDR_ENV=1` and Herdr availability before touching its layout.
2. Match workspaces by canonical pane cwd rather than label; reuse a suitable workspace or create one with the project's absolute path and `--no-focus`. A new workspace's JSON already returns its tab and root pane: use that pane for the worker if it is an available, ready shell with verified cwd, unless a separate tab was explicitly requested; do not create a redundant tab. Never reuse an unrelated user's tab.
3. Choose agent/model/thinking by explicit request, then preferences, then the least expensive **capable** option with suitable latency and quality. Ask before any unavailable-model fallback; verify native CLI flags rather than assuming all CLIs use Pi's thinking levels. Starting a new CLI/agent still takes time; never disable MCP, extensions or similar features solely for speed without approval.
4. For every `/skill:megagem` implementation request, including edits to this repository's skill or extension and first-time workspace/worker bootstrap, delegate file changes to a suitable worker tab. Pi may inspect, verify, and commit/push if requested, but never implement files itself; if no worker can be started, report the blocker without local edits. Fast path: reuse the same dedicated worker/tab when canonical cwd, live identity/session, ready state, no pause/intervention, and suitable model/thinking are verified; do not create tabs by habit unless requested. Combine read-only discovery or reuse trustworthy results in the same invocation, but always check `HERDR_ENV=1` before Herdr control commands, compatible `herdr status`, real project identity, pane readiness and permissions. Dispatch independent tasks in separate tabs **without waiting** by default, including with one worker. When available, the Pi extension's `megagem_dispatch` tool submits the prompt and watches that specific pane/session; after confirmed submission Pi replies only `task assigned to <workspace>/<tab name> — <agent> <model>, <thinking label> <level>`, **translated into the language of your request**, with real Herdr labels and the agent, model and thinking level chosen for the task (one line per successful task), not a claim of completion. No status, ledger, estimates or other text in that dispatch reply; if submission is blocked, fails or is uncertain, report it truthfully instead. Keep the ledger internal. Serialize conflicting edits on the same worker session. Separate tabs do not isolate repository files.
5. After Herdr reports a watched worker as settled or blocked, the extension sends an event to the **same running Pi session**. Pi then checks the actual files/tests and reports the verified result or blocker here; a settled state alone is not proof of success. If Pi is busy, the event queues as a follow-up instead of interrupting the current turn. `/skill:megagem status` still works manually. Closing Pi stops monitoring; reopening the same session restores pending watches. If only the skill is loaded, no automatic event is possible. If you explicitly ask Pi to **wait for completion**, it may instead use a timed wait and remain busy during that turn. Leave tabs open; unexpected user intervention pauses further automatic prompts to that worker.

The skill never approves agent prompts, bypasses permissions, stops Herdr or closes someone else's tabs. A successful prompt submission is not a successful task. Verification and automatic completion feedback remain in a **later** reply, separate from the one-line assignment message. The explicit one-line format for that message overrides general ADHD advice to include next actions or state.

Example dispatch reply when Herdr reports workspace label `api` and tab label `login` (illustrative labels, not IDs):

```text
task assigned to api/login — claude sonnet, effort medium
```

In an Italian request the same reply is `compito assegnato a api/login — claude sonnet, effort medium`; in Spanish `tarea asignada a api/login — claude sonnet, effort medium`; in Veneto `conpito assegnà a api/login — claude sonnet, effort medium` (or `laoro assegnà a …`). Only the leading phrase is translated: labels, agent, model identifiers and the thinking term (`thinking` for Pi, `effort` for Claude, `reasoning` for Codex) are not. The agent is the live value Herdr reports; model and level are what Megagem actually passed at startup (or recorded for a reused worker). Herdr does not expose them, so when they cannot be verified the line says so (`codex model unverified, reasoning unverified`, translated) instead of guessing. All replies follow the user's language, including Veneto and other Veneto-region dialects, which are treated as real languages (not as ambiguous Italian) and answered in kind: if it is ambiguous Pi uses the language of your most recent earlier message, otherwise English. Fixed identifiers, Herdr states, commands and the `[Megagem automatic …]` notice prefixes stay as they are. Notices produced by the extension itself (`/quiet-mode` messages, the one-line failed-tool notice and the unanswered-event alert) are fixed English text because the extension cannot detect your language; Pi's own replies are not.

### Event delivery and empty-reply guard

Worker events reach the coordinator as a **user-role** message (`pi.sendUserMessage(..., { deliverAs: "followUp" })`) that starts with `[Megagem automatic worker notification - not typed by the user]`. In an A/B replay of the real session, custom-role (`sendMessage`) triggers gave a visible reply in 1 of 6 runs and often an empty assistant message (`stopReason: stop`, no text), while user-role triggers did in 7 of 7; wording, session-id format and the ADHD ruleset made no consistent difference. The cause inside Pi is not known.

`extensions/feedback-guard.ts` tracks each delivered event. If Pi settles and the event still has no visible textual reply (a tool-call-only message does not count), it sends **one** reminder through the same user-role path; if that is also empty, or the run was aborted, it shows a warning notification plus a durable `megagem-feedback-alert` message (no new turn) saying the result is **not verified**. Messages contain only coordinator-owned fields (task label, state, pane), never worker output, and never claim success. Bounded: one reminder per event, one alert; you can type new instructions at any time.

Helper modules are `.ts` because `/reload` re-reads `.ts` imports but reuses already-loaded `.mjs` modules; restart Pi once after updating from an older install.

## Quiet mode (`/quiet-mode`)

```text
/quiet-mode          toggle
/quiet-mode on       hide tool calls and outputs in this Pi chat
/quiet-mode off      default Pi display
/quiet-mode status
```

Opt-in and **off by default**. It uses Pi's public `registerToolRenderer` API to draw **no** row for any tool call (built-in, MCP or `megagem_dispatch`), leaving user messages, assistant replies and worker feedback. Applies immediately to rows already on screen and survives `/reload` and resume (stored as a non-context custom session entry; new sessions start OFF). Needs `extensions/megagem-quiet.ts` loaded; a skill alone cannot hide Pi-rendered tool calls.

It changes drawing only: tools still run, approval dialogs and `tool_call` guards still work, the session history/audit keeps every call and result, and Ctrl+O does not reveal rows while ON. A **failed** tool shows one fixed line (no output, so no secrets) so a failure is never silent. Not covered: `!`/`!!` user shell commands, thinking blocks (Ctrl+T / `hideThinkingBlock`), startup header (`quietStartup`), images in tool results, and Pi/extension notifications and approval prompts.

## Validation

Run the deterministic monitor and guard tests with `node --test tests/*.test.mjs`. They cover quiet-mode parsing, persistence and rendering (the last test drives Pi's real `ToolExecutionComponent` when Pi is found via `PI_CODING_AGENT_DIR` or the global npm prefix, otherwise it is skipped), nonblocking dispatch, fast completion, blocked/uncertain workers, identity changes, reload recovery and the queued Pi feedback message. These do **not** claim to test a real worker or live Herdr integration.

Use an isolated Herdr session/project before exercising control behavior; **do not run these against live user workspaces**:

- Ambiguous project: asks before creating a workspace.
- Existing workspace with matching pane cwd: reuses it; matching label alone does not decide.
- New workspace/root pane, then worker reuse: in an isolated project with no matching workspace, request one `/skill:megagem` edit. Confirm the returned workspace JSON tab/root pane is used for the worker if its shell/cwd/readiness are suitable, with no redundant `herdr tab create`. After the first task is verified, request another compatible edit: confirm live cwd, identity/session, ready state, no pause/intervention and model/thinking suitability, then reuse that worker/tab without restarting it. Check that both dispatches return without waiting; never skip safety checks or disable integrations for speed.
- Megagem self-edit during bootstrap: in an isolated copy of `megagem-skill` with no matching workspace, request `/skill:megagem` to change `skills/megagem/SKILL.md` (repeat for `extensions/megagem-feedback.ts`). Confirm Pi uses the returned root pane if suitable, delegates all file edits there and returns after submission without waiting; inspect the diff and worker output to confirm Pi made no direct edits. If the worker cannot start, the repository stays unchanged and Pi reports the blocker instead of editing locally.
- Assignment reply format: in an isolated session, dispatch a task to a tab whose live Herdr workspace/tab labels are known; assert that the entire reply is exactly one line, the translation of the leading phrase of `task assigned to <workspace>/<tab name> — <agent> <model>, <thinking label> <level>` into the language of the request, with the agent, model and level actually used (and `unverified` for any that cannot be verified, never an invented value) (repeat with English, Italian and an ambiguous request such as only a path), with those labels untranslated, no ID, ledger or extra line. Dispatch two independent tasks: assert exactly one line per successful submission. Simulate a blocked, failed or uncertain submission (and missing/unverifiable labels): assert truthful reporting, never an assignment claim. After a successful worker settles, check that verification and automatic final feedback arrive in a later turn, not in the assignment reply.
- One slow task: prompt sent without `--wait`, Pi accepts another instruction; after the worker settles, a feedback message triggers verification and a reply in the main chat (while Pi remains running).
- Two independent read-only tasks: distinct tabs and independent completion feedback; two conflicting edits: same worker, sequential prompts only after the previous result is verified and the user authorizes continuation.
- Blocked worker or prompt timeout: inspect state and ask, never auto-approve or duplicate the prompt.
- User interrupts worker: report and pause; resume only after explicit user notice and state inspection.
- Specified unavailable model: ask before substituting it.

Repository layout: `skills/megagem/SKILL.md` is the workflow, `extensions/megagem-feedback.ts` is the Pi adapter, `extensions/megagem-quiet.ts` + `quiet-mode.ts` the optional quiet-mode adapter, and `AGENTS.md` records contribution constraints. The extension runs only in the coordinator's Pi process; it does not start a separate daemon or watch arbitrary user tabs. No agent or model selections are hardcoded.
