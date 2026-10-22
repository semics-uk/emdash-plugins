---
id: T111
title: "Cloudflare staging playground and nightly run"
phase: 1
package: repo
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T110]
spec: [Spikes S1, S2, S5, EV-NFR-01, EV-NFR-02]
---

# T111 · Cloudflare staging playground and nightly run

## Definition

Deploy the playground to Cloudflare staging (Astro Cloudflare adapter, Worker Loader sandbox), confirm S2
(in-process public-route calls) on Worker Loader, run the e2e suite against staging, and add a nightly
staging workflow. Split from T110, which measured the limits with probe Workers.

## Model

**Opus 5.5**: First real deployment of the plugins; platform behaviour may differ from workerd locally.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] e2e smoke against the staging URL fails before deploy (no `STAGING_URL`)
- [ ] One route's T007 budget figure compared with Cloudflare's reported CPU (R27)
- [ ] Nightly job green

## Implementation (green, then refactor)

- `apps/playground/wrangler.jsonc`, `.github/workflows/staging.yml`
- Name every Cloudflare resource with a `semics-staging-` prefix; record them in the Notes.

## Acceptance criteria

- [x] S2 confirmed on Worker Loader and recorded in BUILD-PLAN §7
- [ ] Workflow uses a scoped Cloudflare API token stored as a GitHub secret (owner creates it; needs the GitHub repo)
- [x] CI installs `qpdf` so the T016 `qpdf --check` test runs
- [ ] Lighthouse accessibility ≥ 95 on the booking widget and booking page (moved from T055: not installable offline locally)
- [ ] Linux CI regenerates the T054 card visual baselines once (macOS Chrome baselines, 3% tolerance)
- [ ] Confirm the visitor IP reaches the core on Cloudflare (T056: `callPublicRoute` forwards IP headers and the `cf` object; per-IP limits depend on it)
- [ ] Phase 2 exit on staging: `node apps/playground/load/checkout.mjs <staging URL>` (100 concurrent checkouts for the last 5 seats) gives 5 booked / 95 `SOLD_OUT` on D1 (T057 review F7; proven locally by T056)
- [ ] Re-measure uploaded-PDF upload and render CPU at the 3 MiB cap (R53) on Cloudflare staging; lower the cap if a cold invocation exceeds half the CPU limit (follow-up from T094)
- [ ] Staging runs a Pro build of Events, so the check-in screen and QR passes (R54) are exercised end to end against real Pro routes rather than e2e route mocks (follow-up from T082)
- [x] Playground or staging e2e for the Events opt-out page (/_events/opt-out) against a Pro build, including an opt-out link invalidated by a redeemed booking link (R57, follow-up from T083)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
wrangler deploy --dry-run
```

## Notes

Built and run locally only: nothing was deployed, pushed or published, and no Cloudflare login was used.
The unticked boxes need the live account or GitHub; each is wired into `.github/workflows/staging.yml`
(or `snapshots.yml`) and turns green on the first nightly run once the owner actions below are done.

**What exists**
- `apps/playground/wrangler.jsonc`: the top level is local only (`semics-local-*`, `workers_dev: false`);
  `env.staging` is the only deploy target. `src/worker.ts` is the EmDash Worker entry (handler, `PluginBridge`, cron).
- `astro.config.mjs`: `PLAYGROUND_TARGET=cloudflare` (Cloudflare adapter with passthrough images, D1, R2, Worker
  Loader `sandbox()`; fails the build without `LOADER`); `EMDASH_PRO_DIR` swaps in Events Pro through
  `staging/link-pro.mjs`, a symlink in `node_modules` (no Pro source in the public repo). `/e2e/mail` and
  `/e2e/cron` return 404 on Cloudflare builds.
- `playwright.staging.config.ts` + `staging/e2e/`: smoke (pages, S2 `via: in-process`, a no-JS booking),
  Pro check-in (R54: real `checkin/code`, then "Already checked in"), Pro opt-out (R57: update notice from the Pro
  "Email attendees" route, opt-out link works; after the emailed booking link is redeemed an older link is
  invalid). Pro specs skip on a Free build, and fail instead when `STAGING_EXPECT_PRO=1`.
- `staging/`: `build.mjs` (`build:staging`), `target.mjs` (target + `--assert-build` guard), `seed-sql.mjs` (D1 seed
  dump; the public e2e admin token is replaced by the `STAGING_ADMIN_TOKEN` hash or dropped), `cpu.mjs` (R27,
  Workers GraphQL analytics), `lighthouse.mjs`, `visitor-ip.mjs`; `load/checkout.mjs --shared-ip`.
- `scripts/staging.test.mjs` (23 tests, in `test:scripts`): schedule, secret names only, staging-only deploys,
  read-only Pro checkout, qpdf in CI, the wrangler env, and every helper.
- Decisions R80–R83; BUILD-PLAN §7 "S2 on Worker Loader".

**Evidence (all local)**
- Red: `node --test scripts/staging.test.mjs` failed with ERR_MODULE_NOT_FOUND (helpers missing). The staging
  Playwright run with no target fails with "STAGING_URL is not set: deploy staging first …" (permanent behaviour).
- Green: 23/23 script tests; `pnpm verify` passed; the regular playground e2e 112 passed (E2E_PORT=4411).
- `wrangler deploy --dry-run` (Verify) passes on the staging build: bindings DB `semics-staging-playground`,
  MEDIA `semics-staging-media`, SESSION KV, LOADER, ASSETS; 20.3 MiB, 5.2 MiB gzip.
- Cloudflare build + Events Pro under `wrangler dev` (Miniflare, Worker Loader), local D1 seeded from the dump
  (re-seeding is idempotent): smoke 3/3 and Pro check-in passed; `visitor-ip.mjs --d1 local` ok ("not-unknown");
  load race `{"booked":5,"refused":{"SOLD_OUT":14,"RATE_LIMITED":81}}`, no oversell.
- Node build + Events Pro (`EMDASH_PRO_DIR=…/emdash-plugins-pro E2E_PORT=4411 pnpm --filter playground
  e2e:staging:local`): 6/6, including both opt-out journeys and the check-in.

**Deviations**
- Phase 2 exit on staging cannot give 95 `SOLD_OUT`: on Cloudflare the core sees the runner's one real IP
  (`cf-connecting-ip` wins whenever a `cf` object exists), so the per-IP limit refuses most buyers. The nightly
  requires exactly 5 booked and every other buyer `SOLD_OUT` or `RATE_LIMITED` (R82), then reseeds D1.
- R81: a Cloudflare site needs `EMDASH_SITE_URL`, or every Pro operation answers `LICENCE_INVALID`, even on
  workers.dev. The nightly deploys with `--var EMDASH_SITE_URL:$STAGING_URL`.
- Opt-out (R57) runs on the local Pro build only, because the e2e mailbox is per-isolate memory and the deployed site
  has no `/e2e` helpers. The criterion allows "playground or staging".
- R53 (PDF CPU at 3 MiB) is not wired: the Pro variant links Events Pro only. Follow-up: link E-sign Pro the same
  way (`link-pro.mjs` `PACKAGES`) and add a staging spec that uploads a 3 MiB template, then read its CPU with
  `cpu.mjs --route`.
- R27: there is no measured T007 figure for `public/events` in the repo, so the nightly compares against
  `vars.T007_PUBLIC_EVENTS_CPU_MS`, which defaults to the 50 ms ceiling. Follow-up: record the harness figure there.
- Cloudflare resources (created on the first deploy, none yet): Worker `semics-staging-playground`, D1
  `semics-staging-playground`, R2 `semics-staging-media`, and the KV namespace for Astro sessions (binding `SESSION`,
  provisioned and named by wrangler from the Worker name).

**Owner actions**
1. Cloudflare (Workers Paid, needed for Worker Loader): enable R2 and make sure the account has a workers.dev subdomain.
   Create an API token at My Profile, API Tokens, Custom token, scoped to this account only, with these permissions:
   Account / Workers Scripts: Edit; Account / D1: Edit; Account / Workers R2 Storage: Edit; Account / Workers KV
   Storage: Edit; Account / Account Analytics: Read. Add no zone permissions.
2. GitHub `semics-uk/emdash-plugins`, Settings, Environments: create `staging` and add these secrets:
   `CLOUDFLARE_API_TOKEN` (the token from step 1), `CLOUDFLARE_ACCOUNT_ID`, `STAGING_ADMIN_TOKEN` (a fresh
   `ec_pat_` + 32 random base64url characters, never reused), and `PRO_REPO_TOKEN` (a fine-grained PAT with
   Contents: Read on `semics-uk/emdash-plugins-pro` only).
3. Repository variables: `STAGING_URL=https://semics-staging-playground.<subdomain>.workers.dev` and
   `STAGING_ENABLED=true`. `T007_PUBLIC_EVENTS_CPU_MS` is optional.
4. Actions, "Staging nightly", Run workflow. The first deploy provisions D1, R2 and KV. After that it runs nightly at
   03:17 UTC. Then tick: the nightly is green; R27 (the `cpu.mjs` line in the log); Lighthouse; visitor IP; Phase 2
   exit; Pro check-in on staging; the token box.
5. Actions, "Regenerate visual baselines", Run workflow, once. If the downloaded PNGs differ, commit them, then tick
   the T054 baselines box.
