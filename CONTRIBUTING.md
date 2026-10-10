# Contributing

## Setup

```sh
nvm use                      # Node 24.21.0 (.nvmrc)
corepack pnpm@10.23.0 install
```

## One command

```sh
pnpm verify
```

runs every gate, cheapest first, and stops at the first failure:

1. Biome lint and format check (`biome ci .`)
2. Task board check (`pnpm tasks:check`)
3. Script tests (`pnpm test:scripts`)
4. For each package: `emdash-plugin validate`, typecheck, tests with coverage thresholds, build
5. Playground typecheck

CI (`.github/workflows/ci.yml`) runs the same command, plus `actionlint` and Playwright.

Useful single steps: `pnpm check` (Biome lint, format and import sorting, with fixes), `pnpm lint`,
`pnpm format`, and in a package `pnpm test`, `pnpm test:coverage`, `pnpm verify`.

Code style is Biome's: tab indentation, double quotes, 120 columns, sorted imports, no unused
imports or variables. `apps/playground` and `.astro` files are not yet in Biome's scope.

## TDD standard

1. **Red.** Write the tests listed under "Tests first" and run them. They must fail, and fail for
   the reason the task describes (not a typo or a missing import). Commit them as `test(T###): ...`.
2. **Green.** Write the smallest implementation that passes. Commit as `feat(T###): ...`.
3. **Refactor.** Improve names and structure with the tests green. Commit as `refactor(T###): ...`.
4. Add a test for every bug found later before fixing it.

### Test layers, cheapest first

| Layer | Tool | Use for |
| --- | --- | --- |
| Unit | Vitest | Pure domain logic in `src/domain/**` and `packages/shared/**`. No host, no I/O |
| Plugin host | `createPluginTestHost()` | Routes, hooks, KV, storage, capability denial, faked HTTP |
| Runtime host | `createPluginRuntimeTestHost()` | Auth, CSRF, permissions, content hooks, cron, Block Kit, editor panels, MCP |
| End to end | Playwright on `apps/playground` | User journeys, accessibility, no-JS paths, headers |
| Load / property | Vitest + D1, `apps/playground/load` | Concurrency invariants (inventory, waitlist, promo limits) |

### Rules

- Domain logic is pure and lives in `src/domain/`; routes are thin adapters. Unit tests cover the
  domain; host tests cover the adapter.
- Every route and cron test asserts its platform budget with the T007 harness (at most 10 bridge
  calls, CPU ceiling) until Cloudflare staging (T110) measures the real limits.
- Every public route has tests for: bad input, missing or wrong token, rate limit, and a response
  containing no one else's data.
- Time and randomness are injected, never read directly in domain code, so tests are deterministic.
- Coverage: 90% lines for `src/domain/**` and `packages/shared/**` (enforced by
  `vitest.coverage.mjs`, which each package's `vitest.config.ts` uses); 100% branches for security
  modules (tokens, HMAC, licence, audit chain, sanitiser).
- No snapshot test without a human-readable assertion beside it.

## Definition of Done

See [tasks/README.md](tasks/README.md): every "Tests first" test seen failing then passing,
acceptance criteria checked, `pnpm verify` green, budget assertions for new routes and cron jobs,
manifest changes deliberate, a changeset for any published package that changed, a clean automated
code review, PRD requirement IDs in test names, and the task set to `done`.
