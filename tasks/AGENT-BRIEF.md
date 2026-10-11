# Brief for task agents

You are implementing exactly one task from this repo's build plan, in your own git worktree.

## Before you write anything

1. Read `tasks/README.md` (TDD standard, Definition of Done, module boundaries) and your task file `tasks/T###-*.md`.
2. If your task touches `packages/events` or `packages/esign`, read `packages/events/skills/creating-plugins/SKILL.md`.
3. Read the PRD requirement IDs and BUILD-PLAN sections listed in your task's `spec` (BUILD-PLAN.md and RESEARCH.md are in the repo root).

## Environment

```sh
export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm use 24.21.0
corepack pnpm@10.23.0 install --offline || corepack pnpm@10.23.0 install
```

Always run pnpm as `corepack pnpm@10.23.0`. The disk is nearly full: don't add a dependency unless the
task needs it, and never download browsers (Playwright uses `/opt/pw-browsers/chromium` if present,
otherwise the system Chrome via `channel: "chrome"`).

If you start the playground site, use the port given in your instructions, never the default.
Only one agent may run the playground at a time: the workerd sandbox runner always binds ports from
18788, so a second server (or a leftover `workerd`) fails with `bind(): Address already in use`. Stop
every server and `workerd` process you start before finishing. Build the events package before an
e2e run (`corepack pnpm@10.23.0 --filter @semics-tech/emdash-events build`).

If sourcing nvm is refused, put Node first on PATH instead:
`export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH"`.

## Workflow

1. Set `status: in-progress` in your task file.
2. **Red:** write every test listed under "Tests first". Run them and confirm each fails for the reason
   the task describes. Commit: `test(T###): <what>`.
3. **Green:** smallest implementation that passes. Commit: `feat(T###): <what>`.
4. **Refactor** with tests green. Commit: `refactor(T###): <what>` (skip if nothing to improve).
5. Run the task's Verify commands, plus `pnpm verify` once T001 exists. Everything must pass.
6. Tick the checkboxes you satisfied in the task file, set `status: review`, add a `## Notes` section
   with anything a reviewer must know, and commit: `chore(T###): ready for review`.

Commit with: `git -c user.name="Ollie Breeden" -c user.email="olliebreeden1@gmail.com" commit -m "…"`
and end every commit message with a blank line and:
`Co-Authored-By: Claude <noreply@anthropic.com>`

## Rules

- Stay inside your task. Don't edit other task files, `tasks/BOARD.md` or `tasks/board.json` (the
  orchestrator regenerates them).
- Don't push, publish, deploy, log in to anything, or touch files outside your worktree.
- Never print or commit secrets (`.env`, tokens, keys).
- If something in the task is wrong or impossible, don't improvise a different scope: record it under
  `## Notes`, finish what is possible, and say so in your report.

## Your final report

Reply with: what you built, the test evidence (the failing run, then the passing run, summarised),
files changed, any deviation from the task file, and follow-ups for other tasks.
