# Megagem repository instructions

- The coordinator host is Pi. The stable explicit invocation is `/skill:megagem <prompt>`; do not add a `/megagem` alias.
- The single source of coordination behavior is `skills/megagem/SKILL.md`. The optional Pi adapter `extensions/megagem-feedback.ts` supplies nonblocking Herdr dispatch and completion feedback; keep the skill usable without it.
- Herdr is a required runtime dependency. Before a Herdr control command check `HERDR_ENV=1`, then follow the installed `herdr --skill` instructions and current CLI help. Never manage a user's live Herdr layout while merely testing this repository.
- Pi stays the user's main interlocutor. Workers are visible tabs. Independent tasks may use different tabs; tasks with conflicting edits are serialized in one worker session. Pause automation on observable interruption, and wait for the user to announce that their tab intervention is finished.
- Do not assume a worker's model, readiness, success or the cause of a state change from a terminal title or a tab label. Use live Herdr state and verify before retrying a prompt.
- No silent agent/model substitutions, destructive cleanup, worktree creation, trust grants, approval bypass or background daemon changes. A session-scoped feedback watcher is allowed only for jobs dispatched by Megagem; it must stop on session shutdown and never alter a user's tabs. Preserve user tabs and report unresolved ambiguity.
- When changing coordination behavior, update README examples and check the skill against: ambiguous project; existing workspace; parallel independent work; conflicting edits; blocked worker; human interruption; unavailable model. Prefer isolated test sessions over modifying live user workspaces.
