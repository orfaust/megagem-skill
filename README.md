# Megagem

A Pi skill and companion Pi extension that coordinate coding workers in Herdr. The **main Pi conversation** remains the user's point of contact. Pi assigns bounded tasks to visible worker tabs (Pi, Claude or Codex) and **returns immediately after dispatch**. When a Megagem-dispatched worker settles, the extension wakes Pi to verify the result and reply in the main chat; you can give Pi another instruction while the worker runs. You can still open and intervene in worker tabs.

## Prerequisites

- Herdr CLI and a compatible running Herdr server; **start Pi inside a Herdr-managed pane** (`HERDR_ENV=1`). Megagem stops rather than manipulating a Herdr session from outside it.
- Pi with the Agent Skills command enabled. Install and authenticate any worker CLI you want Megagem to use; Herdr supports more agents, but this initial skill routes only Pi, Claude and Codex.
- Review the skill before installation. Installing it does not create workspaces or start workers; those actions happen only on an explicit request.

## Install for Pi

From this repository, run `pi install ./` (or `pi install ./ -l` for a project-local installation). Pi loads both `skills/megagem/SKILL.md` and `extensions/megagem-feedback.ts` via `package.json`. Run `/reload` in an existing Pi session to pick up changes. For a one-off run, start Pi with `pi --skill ./skills/megagem --extension ./extensions/megagem-feedback.ts` from this repository. Loading only the skill retains manual `/skill:megagem stato` checks but **not** automatic feedback.

Invoke explicitly:

```text
/skill:megagem In C:\path\to\project, implementa il login e verifica i test
```

`/skill:megagem` is Pi's built-in explicit skill invocation. There is **no `/megagem` command or Pi extension in this MVP**: a normal message beginning with “megagem” is not a guaranteed trigger. If an alias becomes necessary, add a thin Pi adapter later; keep coordination rules in the skill so other hosts can reuse them with their own installation and command integration. Claude or Codex acting as a **worker** does not require Claude/Codex to install this skill. Making either a **coordinator** is separate future work.

## Behavior

1. Resolve the project from an explicit path, otherwise the coordinator's current project directory; ask if ambiguous. Check `HERDR_ENV=1` and Herdr availability before touching its layout.
2. Match workspaces by pane cwd rather than label; reuse a suitable workspace or create one with the project's absolute path and without stealing focus. Never reuse an unrelated user's tab.
3. Choose agent/model/thinking by explicit request, then preferences, then the least expensive **capable** option with suitable latency and quality. Ask before any unavailable-model fallback; verify native CLI flags rather than assuming all CLIs use Pi's thinking levels.
4. Dispatch independent tasks in separate tabs **without waiting**, including with one worker. When available, the Pi extension's `megagem_dispatch` tool submits the prompt and watches that specific pane/session; Pi replies with workspace/tab and submitted status, not a claim of success. Serialize conflicting edits on the same worker session. Separate tabs do not isolate repository files.
5. After Herdr reports a watched worker as settled or blocked, the extension sends an event to the **same running Pi session**. Pi then checks the actual files/tests and reports the verified result or blocker here; a settled state alone is not proof of success. If Pi is busy, the event queues as a follow-up instead of interrupting the current turn. `/skill:megagem stato` still works manually. Closing Pi stops monitoring; reopening the same session restores pending watches. If only the skill is loaded, no automatic event is possible. If you explicitly ask Pi to **wait for completion**, it may instead use a timed wait and remain busy during that turn. Leave tabs open; unexpected user intervention pauses further automatic prompts to that worker.

The skill never approves agent prompts, bypasses permissions, stops Herdr or closes someone else's tabs. A successful prompt submission is not a successful task.

## Validation

Run the deterministic monitor tests with `node --test tests/*.test.mjs`. They cover nonblocking dispatch, fast completion, blocked/uncertain workers, identity changes, reload recovery and the queued Pi feedback message. These do **not** claim to test a real worker or live Herdr integration.

Use an isolated Herdr session/project before exercising control behavior; **do not run these against live user workspaces**:

- Ambiguous project: asks before creating a workspace.
- Existing workspace with matching pane cwd: reuses it; matching label alone does not decide.
- One slow task: prompt sent without `--wait`, Pi accepts another instruction; after the worker settles, a feedback message triggers verification and a reply in the main chat (while Pi remains running).
- Two independent read-only tasks: distinct tabs and independent completion feedback; two conflicting edits: same worker, sequential prompts only after the previous result is verified and the user authorizes continuation.
- Blocked worker or prompt timeout: inspect state and ask, never auto-approve or duplicate the prompt.
- User interrupts worker: report and pause; resume only after explicit user notice and state inspection.
- Specified unavailable model: ask before substituting it.

Repository layout: `skills/megagem/SKILL.md` is the workflow, `extensions/megagem-feedback.ts` is the Pi adapter, and `AGENTS.md` records contribution constraints. The extension runs only in the coordinator's Pi process; it does not start a separate daemon or watch arbitrary user tabs. No agent or model selections are hardcoded.
