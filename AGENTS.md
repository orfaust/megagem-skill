# Megagem repository instructions

- The coordinator host is Pi. The stable explicit invocation is `/skill:megagem <prompt>`; do not add a `/megagem` alias.
- The single source of coordination behavior is `skills/megagem/SKILL.md`. The optional Pi adapter `extensions/megagem-feedback.ts` supplies nonblocking Herdr dispatch and completion feedback; keep the skill usable without it.
- Herdr is a required runtime dependency. Before a Herdr control command check `HERDR_ENV=1`, then follow the installed `herdr --skill` instructions and current CLI help. Never manage a user's live Herdr layout while merely testing this repository.
- Pi stays the user's main interlocutor. Workers are visible tabs. Independent tasks may use different tabs; tasks with conflicting edits are serialized in one worker session. Pause automation on observable interruption, and wait for the user to announce that their tab intervention is finished.
- Do not assume a worker's model, readiness, success or the cause of a state change from a terminal title or a tab label. Use live Herdr state and verify before retrying a prompt.
- No silent agent/model substitutions, destructive cleanup, worktree creation, trust grants, approval bypass or background daemon changes. A session-scoped feedback watcher is allowed only for jobs dispatched by Megagem; it must stop on session shutdown and never alter a user's tabs. Preserve user tabs and report unresolved ambiguity.
- When changing coordination behavior, update README examples and check the skill against: ambiguous project; existing workspace; parallel independent work; conflicting edits; blocked worker; human interruption; unavailable model. Prefer isolated test sessions over modifying live user workspaces.

## Maintainer notes

- Event delivery: worker events reach Pi as a **user-role** message (`pi.sendUserMessage(..., { deliverAs: "followUp" })`) starting with `[Megagem automatic worker notification - not typed by the user]`. In an A/B replay of a real session, custom-role (`sendMessage`) triggers gave a visible reply in 1 of 6 runs (often an empty assistant message, `stopReason: stop`), user-role triggers in 7 of 7; wording, session-id format and the ADHD ruleset made no consistent difference. The cause inside Pi is unknown.
- `extensions/feedback-guard.ts`: if Pi settles with an event still lacking visible text (a tool-call-only message does not count) it sends one reminder through the same path; otherwise, or after an abort, it shows a warning notification and a durable `megagem-feedback-alert` message (no new turn). Messages hold only coordinator-owned fields (task label, state, pane), never worker output, and never claim success.
- Helper modules are `.ts` because `/reload` re-reads `.ts` imports but reuses already-loaded `.mjs` modules.
- Quiet mode uses Pi's public `registerToolRenderer`; it never alters tool results or history.
- The extension runs only in the coordinator's Pi process: no daemon, no watching of arbitrary user tabs, no hardcoded agent or model.

## Manual verification scenarios

Run only in an isolated Herdr session/project; **never against live user workspaces**. The automated tests do not cover these.

- Ambiguous project: asks before creating a workspace.
- Existing workspace with matching pane cwd: reuses it; a matching label alone does not decide.
- New workspace/root pane, then worker reuse: in an isolated project with no matching workspace, request one `/skill:megagem` edit. Confirm the returned workspace JSON tab/root pane is used for the worker if its shell/cwd/readiness are suitable, with no redundant `herdr tab create`. After the first task is verified, request another compatible edit: confirm live cwd, identity/session, ready state, no pause/intervention and model/thinking suitability, then reuse that worker/tab without restarting it. Both dispatches must return without waiting; never skip safety checks or disable integrations for speed.
- Megagem self-edit during bootstrap: in an isolated copy of `megagem-skill` with no matching workspace, request `/skill:megagem` to change `skills/megagem/SKILL.md` (repeat for `extensions/megagem-feedback.ts`). Confirm Pi uses the returned root pane if suitable, delegates all file edits there and returns after submission without waiting; inspect the diff and worker output to confirm Pi made no direct edits. If the worker cannot start, the repository stays unchanged and Pi reports the blocker instead of editing locally.
- Assignment reply format: dispatch a task to a tab whose live Herdr workspace/tab labels are known and assert the entire reply is exactly one line, the translation of the leading phrase of `task assigned to <workspace>/<tab name> — <agent> <model>, <thinking label> <level>` into the language of the request, with the agent, model and level actually used (`unverified` for any that cannot be verified, never an invented value) and labels untranslated, no ID, ledger or extra line. Repeat with requests in different languages and with an ambiguous request such as only a path. Dispatch two independent tasks: exactly one line per successful submission. Simulate a blocked, failed or uncertain submission (and missing/unverifiable labels): truthful reporting, never an assignment claim. After a successful worker settles, verification and automatic final feedback must arrive in a later turn, not in the assignment reply.
- One slow task: prompt sent without `--wait`, Pi accepts another instruction; after the worker settles, the feedback message triggers verification and a reply in the main chat while Pi keeps running.
- Two independent read-only tasks: distinct tabs and independent feedback. Two conflicting edits: same worker, sequential prompts only after the previous result is verified and the user authorizes continuation.
- Blocked worker or prompt timeout: inspect state and ask; never auto-approve or duplicate the prompt.
- User interrupts a worker: report and pause; resume only after explicit user notice and state inspection.
- Specified unavailable model: ask before substituting it.
