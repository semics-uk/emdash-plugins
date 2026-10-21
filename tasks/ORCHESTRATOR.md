# Orchestrator runbook

You are the orchestrator for this build. Read this file, `tasks/README.md` (standards) and
`tasks/AGENT-BRIEF.md` (what task agents follow). Do not read BUILD-PLAN.md, RESEARCH.md or the PRDs
in full; the per-package `CONTEXT.md` files summarise them.

## The owner

- Hands-off. Decide everything yourself, record decisions in BUILD-PLAN.md §12, never ask questions.
- Only surface what physically needs them (accounts, payments, legal), as a statement, not a question.
- They read on a phone: keep chat replies short; the board page is how they follow progress.
- They asked to keep token usage down: quiet commands, small prompts, no re-running gates needlessly.

## State (2026-10-21)

- 24 of 94 tasks done (see the board). T111 needs the GitHub repo and a Cloudflare CI token from the owner. Board: `node scripts/tasks.mjs`, page:
  `node scripts/board-page.mjs . <scratch>/build-board.html` then publish to
  https://claude.ai/artifact/TuztqKnpDhZWYtrJry55L5 (Artifact tool, `url` of that artifact).
- Cloudflare: wrangler logged in (device flow) as oliver@semics.co.uk; Workers Paid on. T110 measured the
  limits (BUILD-PLAN §7, R22–R27) and deleted its probe Workers; staging deploy is T111.
- Nothing is pushed; there is no remote yet. GitHub org `semics-uk`, npm scope `@semics-tech`.

## The loop

1. `node scripts/tasks.mjs` → Ready list. Pick by critical path first (printed in `tasks/BOARD.md`).
2. Check free memory first (`vm_stat`; the owner runs other things, including a VM). Run at most **2**
   agents at once (3 only when memory is plentiful), at most one per package (shared-library tasks in separate files may
   share), and only **one** that runs the playground (workerd binds ports from 18788).
3. Launch: `Agent` with `subagent_type: general-purpose`, `model` from the task (`opus`/`sonnet`),
   `isolation: worktree`, `run_in_background: true`. Prompt template:

   > You are a task agent in /Users/semics/code/semics/emdash-plugins (isolated worktree). Implement
   > T### ("title"). Read tasks/AGENT-BRIEF.md, tasks/README.md, tasks/T###-*.md and the CONTEXT.md of
   > each package you touch. [2–6 lines of task-specific context: files other agents are editing right
   > now, decisions that apply, anything the task file doesn't say.] Finish with the brief's report.

4. On a report: check `git merge-base --is-ancestor main <branch>`; if behind, rebase it yourself
   (`git -c user.name="Ollie Breeden" -c user.email="olliebreeden1@gmail.com" rebase main`; BUILD-PLAN
   conflicts: keep both sides). Re-run gates **only** if the rebase had conflicts or the agent didn't run
   `pnpm verify` after its last change. Read the key new file(s) for correctness; fix small issues
   yourself with a test-first commit pair.
5. Mark the task `status: done` in the worktree, `git merge --ff-only <branch>` on main, reinstall
   (`corepack pnpm@10.23.0 install --offline --reporter=silent`), `node scripts/tasks.mjs`, commit the
   board, `git worktree remove --force <path>` and `git branch -D <branch>`.
6. Fold follow-ups from the report into the affected task files' acceptance criteria (insert before the
   "Meets the Definition of Done" line) and decisions into BUILD-PLAN.md.
7. Republish the board page; tell the owner in a few lines what landed and what's running.
8. If agents stop on a usage limit, resume them with `SendMessage` (same session) or relaunch into the
   same worktree (new session). Before relaunching anything, kill leftover processes:
   `pgrep -fl "workerd|dist/server/entry"`.

## Commands and conventions

- Environment: `export PATH="$HOME/.nvm/versions/node/v24.21.0/bin:/opt/homebrew/bin:$PATH"`; always
  `corepack pnpm@10.23.0`. `pnpm verify` is quiet (log in `.verify.log`), about 2 min unloaded.
- Commits: `-c user.name="Ollie Breeden" -c user.email="olliebreeden1@gmail.com"`, messages end with a
  blank line and `Co-Authored-By: Claude <noreply@anthropic.com>`.
- Model labels in task files: `opus-5.5` / `sonnet-5.5`. Re-assign a Sonnet task to Opus if green fails
  twice.

## Lessons so far

- Workspace libraries go in the cores' `devDependencies` (inlined by the bundler).
- EmDash content fields are snake_case; plugin storage fields camelCase.
- `content:beforeDelete` must return exactly `false`; needs `content:read`.
- Secrets outside `settingsSchema` are stored in plaintext: derive client secrets from one declared key.
- Registry installs use an `r_…` plugin ID; never hard-code the slug in UI or suite code.
- Agents leave `workerd` processes behind when stopped; clean up before the next playground run.
- The usage limit has stopped agents three times; three parallel agents drain it fast.
- `isolation: worktree` can start an agent on an old commit: every prompt now begins with "rebase main
  and install first". Land with `land.sh` (`scripts/orchestrator/land.sh <agent-id> <T###>`; it rebases, auto-resolves the shared
  `src/index.ts` export list, marks done, merges, installs, regenerates the board).
- Test runs are the biggest memory user: vitest holds a machine-wide lock (one suite at a time across
  worktrees), at most 2 workers, coverage only on CI. Never run your own `pnpm verify` while an agent's
  run is going; it just queues behind the lock.
- CPU budgets are wall-time estimates; on a busy machine they warn (≤ 4x) instead of failing. Stop
  finished agents' leftover background jobs (TaskStop) so they don't load the machine.
- Agents sometimes skip the "ready for review" commit; check `status:` and the checkboxes before landing.
