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
6. Release dry run (`pnpm release:dry-run`): packs and audits what would be published
7. Playground typecheck

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

## Releasing

Nothing is published from a laptop. Releases run in GitHub Actions, from the public repo's `main`.

**Flow**

1. Every change to a published package carries a changeset (see above).
2. `.github/workflows/release.yml` runs on each push to `main`. It builds, then runs the dry run
   (`pnpm release:dry-run --build`), then `changesets/action`:
   - while changesets are pending it opens or updates the "Version Packages" PR (`pnpm version-packages`);
   - when that PR is merged nothing is pending, so it runs `pnpm release`: the dry run in strict mode
     (`--release`), then `changeset publish`, which publishes `@semics-tech/emdash-events`,
     `@semics-tech/emdash-esign` (and the suite package once it exists) to npm with provenance
     (`NPM_CONFIG_PROVENANCE`, OIDC `id-token: write`). `@semics-tech/shared` stays private.
     Publishing is npm trusted publishing (R84): npm swaps the job's OIDC token for a one-off publish
     token, so no npm token is stored; the run first checks npm >= 11.5.1 (`node scripts/npm-trust.mjs check-npm`).
3. If the repository variable `EMDASH_REGISTRY_PUBLISH` is `true`, the `registry` job then calls
   `.github/workflows/emdash-release.yml`, which plans, bundles (`emdash-plugin release prepare`), attests
   and submits each published plugin to the EmDash registry over GitHub OIDC. No registry token is stored.
   It first runs `node scripts/release-dry-run.mjs --require-real-did` and stops on the placeholder DID.

**Dry run.** `pnpm release:dry-run [--build] [--release] [--package <name>]` packs each publishable package
(`pnpm pack`) and bundles it (`emdash-plugin bundle`) into a temp directory, then asserts the expected files are
there and nothing private is: no tests, `.env`, coverage, keys or logs, no Pro code or licence material, no runtime
import of `@semics-tech/shared` (R35), no unresolved `workspace:` dependency. It never logs in or publishes, and
`pnpm verify` runs it. Plain, it only notes the two release blockers (placeholder DID, `"private": true`);
`--release` fails on them.

**Workflow lint.** CI's `actionlint` job lints every workflow. `scripts/release-workflows.test.mjs` is an offline shape
check of the release workflows (pinned actions, provenance, the registry gate, no literal secrets) and runs in
`pnpm test:scripts`.

**Owner setup before the first real release** (none of it is in the repo):

1. Create the public GitHub repository `semics-uk/emdash-plugins` and push (releases need a public repo).
2. npm (trusted publishing, R84; no npm token anywhere): create the GitHub **environment** `npm-publish` (add
   required reviewers). npm only lets a trusted publisher be added to a package that exists, so once, from a
   laptop with npm >= 11.15.0, `npm login` (an account with 2FA that owns the `@semics-tech` org) and run
   `node scripts/npm-trust.mjs bootstrap` (prints the plan) then `node scripts/npm-trust.mjs bootstrap --publish`:
   for each package not yet on npm it publishes an empty, deprecated `0.0.0-bootstrap.0` under the dist-tag
   `bootstrap`, then adds the trusted publisher (organisation `semics-uk`, repository `emdash-plugins`, workflow
   `release.yml`, environment `npm-publish`). The first real publish must follow within 2 days. Then, per
   package on npmjs.com, Settings, Publishing access: "Require two-factor authentication and disallow tokens".
3. Remove `"private": true` from `packages/events` and `packages/esign` (and the suite) in the PR that first
   releases them. Until then `pnpm release` refuses, and Changesets would skip them.
4. Publisher DID (R21): make `semics.dev` resolve as an atproto handle, run `emdash-plugin login`, and replace
   `did:plc:semicsdevplaceholder2222` with the real DID in every `emdash-plugin.jsonc`. Then confirm by running
   `emdash-plugin release setup --trigger=changesets --force` once in a plugin directory and diffing the result
   against `emdash-release.yml`.
5. Delegate release authority to the repository for that DID (`emdash-plugin release delegate`, a browser
   handoff) and approve the first release (`release approve`).
6. Set the repository variable `EMDASH_REGISTRY_PUBLISH=true` to switch the registry job on, and pin the
   `emdash-cms/emdash/apps/release-action@main` reference in `emdash-release.yml` to a tag or commit.
7. Pro: see `.github/workflows/pro-release.yml` in the private Pro repo. It publishes restricted packages to npm
   by trusted publishing too (R84: the org needs a paid npm plan for private packages; no `PRO_NPM_TOKEN`), from
   a `pro-publish` environment, and needs the real licence public key
   (`licence/public-key.txt` or `SEMICS_LICENCE_PUBLIC_KEY`), because `generate --release` refuses a development key.

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
