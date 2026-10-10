# Build tasks

Every piece of work is a task file `T###-slug.md` with front matter (id, phase, package, edition,
status, model, size, dependencies, spec references) and a fixed body: definition, model, tests
first, implementation, acceptance criteria, verify commands.

`node scripts/tasks.mjs` validates every task (known dependencies, no cycles, no task started
before its dependencies are done) and regenerates [BOARD.md](BOARD.md) and `board.json`.
`node scripts/tasks.mjs --check` validates without writing and runs inside `pnpm verify`.

## Kanban workflow

| Column | Meaning | Who moves it |
| --- | --- | --- |
| Backlog | Dependencies not finished | Nobody; it becomes Ready automatically |
| Ready | Every dependency is `done` (computed, not stored) | The agent picks the lowest-numbered Ready task on the critical path first |
| In progress | Tests being written, then code | The agent, on starting |
| Review | Gates green; automated code review and the task's acceptance criteria being checked | The agent |
| Done | Merged with all gates green | The agent |
| Blocked | Waiting on something outside the repo (an owner account) | Cleared when the blocker is gone |

Only one task per package is In progress at a time. A task is never moved to In progress while a
dependency is not Done; the board check fails if it is.

## TDD standard

1. **Red.** Write the tests listed under "Tests first" and run them. They must fail, and fail for
   the reason the task describes (not a typo or a missing import). Commit them as `test(T###): …`.
2. **Green.** Write the smallest implementation that passes. Commit as `feat(T###): …`.
3. **Refactor.** Improve names and structure with the tests green. Commit as `refactor(T###): …`.
4. Add a test for every bug found later before fixing it.

**Test layers, cheapest first**

| Layer | Tool | Use for |
| --- | --- | --- |
| Unit | Vitest | Pure domain logic in `src/domain/**` and `packages/shared/**`. No host, no I/O |
| Plugin host | `createPluginTestHost()` | Routes, hooks, KV, storage, capability denial, faked HTTP |
| Runtime host | `createPluginRuntimeTestHost()` | Auth, CSRF, permissions, content hooks, cron, Block Kit, editor panels, MCP |
| End to end | Playwright on `apps/playground` | User journeys, accessibility, no-JS paths, headers |
| Load / property | Vitest + D1, `apps/playground/load` | Concurrency invariants (inventory, waitlist, promo limits) |

**Rules**

- Domain logic is pure and lives in `src/domain/`; routes are thin adapters. Unit tests cover the
  domain; host tests cover the adapter.
- Every route and cron test asserts its platform budget with the T007 harness (≤ 10 bridge calls,
  CPU ceiling) until Cloudflare staging (T110) measures the real limits.
- Every public route has tests for: bad input, missing or wrong token, rate limit, and a response
  containing no one else's data.
- Time and randomness are injected, never read directly in domain code, so tests are deterministic.
- Coverage: 90% lines for `src/domain/**` and `packages/shared/**`; 100% branches for security
  modules (tokens, HMAC, licence, audit chain, sanitiser).
- No snapshot test without a human-readable assertion beside it.

## Definition of Done

- [ ] Every "Tests first" test exists, was seen failing, and now passes
- [ ] Acceptance criteria all checked
- [ ] `pnpm verify` green: Biome, typecheck, tests with coverage thresholds, `emdash-plugin validate`, builds, board check
- [ ] Budget assertions present for every new route or cron job
- [ ] Manifest unchanged, or the change is a deliberate, documented trust-contract change (major version after 1.0)
- [ ] Changeset added for any published package that changed
- [ ] Automated code review of the diff has no unresolved correctness findings
- [ ] The PRD requirement IDs in `spec` are referenced in test names (for the 1.0 traceability report)
- [ ] Task status set to `done`; `node scripts/tasks.mjs` regenerated the board

## Model assignment

| Model | Assigned when the task involves |
| --- | --- |
| **Opus 5.5** | Concurrency or inventory, cryptography and protocols, tamper evidence, money paths, platform-limit engineering, security-sensitive rendering, cross-package orchestration, phase-gate reviews |
| **Sonnet 5.5** | Configuration, CRUD routes, Block Kit admin pages, email templates, presentational components, docs, well-specified glue over finished modules |

A Sonnet task that turns out harder than expected (two failed attempts at green, or a design
question the task doesn't answer) is re-assigned to Opus 5.5 and the change is noted in the file.

## Module boundaries

| Package | Owns | Never imports |
| --- | --- | --- |
| `packages/shared` | Pure helpers: tokens, HMAC, licence, PDF, ICS, money, time, rrule, outbox, Block Kit builders | Anything from a core or UI |
| `packages/events` core (`src/plugin.ts`, `src/domain`, `src/routes`, …) | Booking rules and data | UI code, e-sign code |
| `packages/events` UI (`src/ui`, `src/astro`, `src/client`, `src/integration`) | Rendering only, via public routes | Core internals |
| `packages/esign` | Same split as events | Anything from events |
| `packages/events-suite` | Wiring between the two products | Business rules |
