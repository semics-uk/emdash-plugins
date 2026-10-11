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
4. Changeset check (`pnpm changeset:check`; skipped on `main`, where there is nothing to compare)
5. For each package: `emdash-plugin validate`, typecheck, tests with coverage thresholds, build
6. Playground typecheck

CI (`.github/workflows/ci.yml`) runs the same command, plus `actionlint` and Playwright.

Useful single steps: `pnpm check` (Biome lint, format and import sorting, with fixes), `pnpm lint`,
`pnpm format`, and in a package `pnpm test`, `pnpm test:coverage`, `pnpm verify`.

Code style is Biome's: tab indentation, double quotes, 120 columns, sorted imports, no unused
imports or variables. `apps/playground` and `.astro` files are not yet in Biome's scope.

## Versioning and changesets

Versions come from [Changesets](https://github.com/changesets/changesets). Run `pnpm changeset`,
pick the package, choose patch, minor or major, and write one line for the changelog. Commit the
generated `.changeset/*.md` with your change. `pnpm changeset status` shows what would be released.

**When a changeset is required.** `pnpm changeset:check` diffs your branch against `main` and fails
when any published package (`packages/events`, `packages/esign`, later `packages/events-suite`) has a
change under `src/`, in `emdash-plugin.jsonc`, or in its `package.json` dependencies without a
changeset that names that package. Changes only to `tasks/`, `docs/`, Markdown, tests, tooling
config, `apps/playground` and `packages/shared` need none. Use `--base <ref>` to compare against
another branch. The published packages are still `"private": true` until their first publish;
Changesets versions them anyway (`privatePackages.version` is on, tagging is off).

**Trust contract.** Before 1.0, versions stay 0.x. From 1.0 the trust contract is frozen: any
change to capabilities, `allowedHosts`, public routes or MCP tools is a **major** version, because
it forces site owners to re-consent. Everything else follows semver (new feature: minor, fix: patch).

**Free and Pro share version numbers.** `@semics-tech/emdash-events-pro` and
`@semics-tech/emdash-esign-pro` are released from the private repo in lockstep with their Free
counterparts: the same number means the same code base. Never bump one edition alone; a Pro-only
change still ships as a new version of both, so the numbers never diverge.

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
