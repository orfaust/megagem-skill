# Megagem

A Pi skill plus a companion Pi extension that coordinate coding workers in Herdr. You keep talking to the **main Pi chat**; Pi hands bounded tasks to visible worker tabs (Pi, Claude or Codex), replies at once, and comes back with a verified result when the worker settles. You can give Pi new instructions while workers run, and you can open or intervene in any worker tab.

## Requirements

- Herdr CLI and a running Herdr server. Start Pi **inside a Herdr pane** (`HERDR_ENV=1`); Megagem refuses to touch Herdr from outside it.
- Pi, plus any worker CLI you want to use (Pi, Claude or Codex), installed and authenticated.
- Installing creates no workspaces and starts no workers; that only happens when you ask.

## Install

Package name: `pi-megagem` (not published yet; install from a local checkout).

```bash
pi install ./         # or: pi install ./ -l   (project-local)
```

Run `/reload` in a running Pi session afterwards. With only the skill loaded, `/skill:megagem status` works but there is no automatic feedback.

## Use

```text
/skill:megagem In C:\path\to\project, implement the login and verify the tests
```

`/skill:megagem` is the only entry point (there is no `/megagem` alias). Pi finds or creates the project's workspace, picks a suitable worker, dispatches **without waiting**, and answers with one line per task:

```text
task assigned to api/login — claude sonnet, effort medium
```

- `api/login` are the real Herdr workspace/tab labels; `claude sonnet, effort medium` are the agent, model and thinking level used for that task.
- Only the leading phrase is translated. Labels, agent, model identifiers and the thinking term (`thinking` for Pi, `effort` for Claude, `reasoning` for Codex) never are.
- Herdr does not expose model or thinking level, so Pi prints what it actually passed at startup. If that cannot be verified the line says so (for example `codex model unverified, reasoning unverified`) instead of guessing.
- **Every reply follows the language you write in, whatever that language or variant is, including regional languages and dialects.** If it is ambiguous (mixed languages or no identifiable language), Pi uses your most recent earlier message, otherwise English.

The assignment is not a completion claim. Edits are always delegated to a worker; Pi inspects and verifies but does not implement files itself, never approves worker prompts or bypasses permissions, and never closes your tabs. Conflicting edits are serialized in one worker; independent tasks get separate tabs. If you intervene in a worker tab, automation for it pauses until you say you are done. The full rules live in [`skills/megagem/SKILL.md`](skills/megagem/SKILL.md).

## Automatic feedback

When a worker dispatched by Megagem settles or blocks, the extension sends one automatic message to the same Pi session (queued if Pi is busy). Pi then checks the live Herdr state, files and tests and reports the **verified** result or blocker in the main chat. A settled state alone is never proof of success.

If Pi answers that message with nothing visible, the extension reminds it once; if that fails too, you get a warning plus a saved alert saying the result is **not verified**. Closing Pi stops monitoring; reopening the session restores pending watches.

## Quiet mode

`/quiet-mode [on|off|status]` (no argument toggles) hides all tool calls and outputs in the Pi chat so you read only the conversation. It is **off by default**, applies immediately, and survives `/reload` and resume. It changes drawing only: tools still run, approvals and the session history are untouched, and a failed tool still shows one line (without output). Not hidden: `!` shell commands, thinking blocks (Ctrl+T), the startup header, images in tool results, and Pi notifications.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "requires a Herdr-managed Pi pane" | Start Pi from a Herdr pane (`HERDR_ENV=1`). |
| No automatic message after a worker finishes | Only the skill is loaded: install the package and `/reload`. |
| Updated an older install and old behavior persists | Restart Pi once; `/reload` does not refresh previously loaded `.mjs` helpers. |
| `/quiet-mode` missing | `extensions/megagem-quiet.ts` is not loaded; check `pi list`. |
| Extension notices are in English | The extension cannot detect your language; Pi's own replies follow it. |

## Development

```bash
node --test tests/*.test.mjs
```

The tests are deterministic: monitor and dispatch logic, the empty-reply guard, quiet-mode parsing/rendering (using Pi's real `ToolExecutionComponent` when Pi is found via `PI_CODING_AGENT_DIR` or the global npm prefix) and the language/assignment-format rules. They do not exercise a real worker or live Herdr.

Layout: `skills/megagem/SKILL.md` (workflow), `extensions/megagem-feedback.ts` (dispatch tool, monitor, guard), `extensions/megagem-quiet.ts` (quiet mode), `tests/`. Maintainer notes and the manual verification scenarios (run only in an isolated Herdr session, never on live workspaces) are in [`AGENTS.md`](AGENTS.md).
