# 1.0 release readiness (T106)

Release-readiness review of both products, 2026-10-22, at public branch `worktree-agent-aa3697af30b9fa57f`
(rebased on main `5378671`, after T111) and Pro branch `pro-agent-t106` (from Pro main `622c61b`). Decisions are BUILD-PLAN §12
R64–R75. Nothing was pushed, published, tagged or deployed.

## Verdict

**Code: go. Publishing: owner-gated.** The 1.0.0-rc.0 candidates are built and every engineering gate is
green (below); no code item is a no-go. Publishing waits only on owner work: the real publisher DID, the
npm/registry/GitHub setup, the lawyer's review of the e-sign wording (D4: "reviewed by a lawyer before 1.0"),
and the Cloudflare/GitHub setup that turns on T111's staging nightly (the staging-only criteria, such as CPU on
real Cloudflare hardware, are owner-gated, not blockers in the code). Once the owner actions are done, publish
the RC, let the nightly run green on it, then cut 1.0.0 (the last owner action).

## Go / no-go checklist

| # | Item | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Trust contracts frozen (Free) | Go | `packages/{events,esign}/trust-contract.json`, `tests/trust-contract.test.ts` (R64) |
| 2 | Trust contracts frozen (Pro) | Go | Pro `packages/{events-pro,esign-pro}/trust-contract.json`, checked by the Pro build suite (R64) |
| 3 | Manifests declare the EmDash range | Go | `release.requires` `env:emdash >=1.2.0 <2`; `scripts/manifest-requires.test.mjs` (EV-NFR-07) |
| 4 | Every PRD requirement maps to a passing test | Go | `node scripts/traceability.mjs --pro <Pro repo>`: 108 requirements, 107 traced, SU-FR-13 not applicable (R66); `scripts/traceability.test.mjs` in `pnpm verify` |
| 5 | PRD feature checklists (BUILD-PLAN §3, §13) | Go, with the documented 1.0 cuts | Admin Waitlist page (R68), answers on booking page/emails (R69), PDF follow-ups (R70), suite page translations (R72), one-click Connect (R66): see "Post-1.0" |
| 6 | Public `pnpm verify` | Go | `pnpm verify` green (all 8 gates), re-run after rebasing on T111; `.verify.log` |
| 7 | Pro `pnpm verify` | Go | Pro `pnpm verify` green (lint, script tests, generate, packages incl. 61 licence Worker tests); Pro `.verify.log` |
| 8 | Full playground e2e | Go | 112 passed in 1.9 min (`E2E_PORT=4473`); `pnpm --filter playground e2e` with `E2E_PORT` (T100 had skipped it) |
| 9 | Free bundle budgets (R51: 116 KiB) | Go | Events 118,756 B (budget 118,784; unchanged by T106), E-sign 107,836 B (105.3 KiB); `bundle-size.build.test.ts` |
| 10 | Pro bundle ceilings (R43: 256 KiB) | Go | Events Pro 207.2 KiB, E-sign Pro 191.3 KiB (unchanged by T106); Pro build suite |
| 11 | Security review: no open severity 1 or 2 | Go | `tasks/reviews/security.md` (T100); finding 20 confirmed as R73 |
| 12 | Dependency audit | Go | vitest 4.1.12 in both repos clears the dev-only advisory (R75); the rest is playground/host-only (security.md) |
| 13 | Release candidates built | Go | Changesets `rc` pre mode, `1.0.0-rc.0` with changelogs; `release:dry-run` packs and bundles each package clean in `pnpm verify` (R65) |
| 14 | Scaffold `hello` route removed | Go | Removed in T100 (security.md finding 12); not in `trust-contract.json` |
| 15 | Publisher DID | **Owner-gated** | Manifests still carry `did:plc:semicsdevplaceholder2222` (R21); the release workflows refuse it |
| 16 | Lawyer review of the e-sign wording (D4) | **Owner-gated** | `docs/legal/brief.md` §13 lists the questions; not yet answered |
| 17 | Cloudflare staging (EV-NFR-01/ES-NFR-01 CPU on real hardware, Lighthouse R83, Phase 2 exit R82) | **Owner-gated (T111 blocked on setup)** | Built and run locally by T111 (R80–R83); the local T007 harness passes (R27); turns green on the first nightly after the owner's Cloudflare/GitHub setup |
| 18 | Upstream EmDash bug (sandboxed `plugin:activate`) | Worked around (R37) | Filing it is an owner action (draft in `docs/upstream/`) |
| 19 | Licence Worker support tooling | Go (not deployed) | Pro `licence-worker/tests/support.worker.test.ts` (R67) |

## What changed in T106

- Public: trust-contract snapshots and tests; `release.requires` in both manifests; traceability (`docs/requirements/prd.json`,
  `scripts/traceability.mjs`, PRD ids added to the titles of tests that already covered them, swapped and wrong labels
  corrected); a pairing-guide docs check (SX-FR-06); one theming default per `--events-*` property and a documented
  table of all of them (EU-NFR-05: the check-in screen's accent default was `#1d4ed8`, now `#0b57d0` like the rest);
  changeset check reads `.changeset/pre/`; `1.0.0-rc.0`; products no longer private; vitest 4.1.12; guides say what
  1.0 leaves out (waitlist page, broadcast speed, PDF templates).
- Pro: licence Worker support routes and stuck-event alert; key email wording on package access; `pro.json` drops
  Free's listing (keeping `release.requires`); Pro trust-contract snapshots; vitest 4.1.12; Pro packages `1.0.0-rc.0`.

## Post-1.0 list

- Admin page listing waitlist entries (R68; needs Free Events backend trimming first).
- Custom answers on the booking page and in emails; asking for answers when a waitlist offer is claimed (R69).
- Several-signer PDF sends; PDF templates for integrations, self-serve and bulk send; deleting PDF templates and their
  file chunks (R70).
- A faster Events Pro mail drain for broadcasts, measured on staging (R71).
- Translations of the suite's pages (R72); emails, calendar files and the Block Kit admin stay English (R58).
- A package registry proxy honouring `semreg_` tokens, or the EmDash registry once it supports paid plugins (R67).
- One-click Connect between Events and E-sign (SX-FR-06's conditional part, R66).
- Visual regression screenshots of the components in two themes (EU-NFR-05's PRD check; 1.0 checks the documented
  properties instead).
- Manual screen-reader pass of the signing ceremony (SU-NFR-03's PRD check; 1.0 has axe on every page at two widths,
  keyboard and reflow tests): listed under owner actions as recommended before 1.0.0 final.

## Owner actions

Do these in order; each says exactly what to run or click. Nothing here was done by an agent.

1. **Publisher identity (R21).** Create the Atmosphere/Bluesky account for the handle `semics.dev` (add the DNS TXT
   record `_atproto.semics.dev` it asks for), then run `npx emdash-plugin login semics.dev` and note the DID it prints
   (`did:plc:...`). Replace `did:plc:semicsdevplaceholder2222` with it in `packages/events/emdash-plugin.jsonc`,
   `packages/esign/emdash-plugin.jsonc` and the Pro repo's tests/fixtures that mention it, then run
   `node scripts/release-dry-run.mjs --release` (must print no blocker) and re-run `npx emdash-plugin release setup
   --trigger=changesets` to regenerate `.github/workflows/emdash-release.yml` (diff it against the committed one).
2. **GitHub.** Create the public repo `semics-uk/emdash-plugins` and the private `semics-uk/emdash-plugins-pro`; push
   `main` of each. In the public repo create the environment `npm-publish` with required reviewers and the secret
   `NPM_TOKEN` (an npm automation token of the `@semics-tech` org owner); leave the variable `EMDASH_REGISTRY_PUBLISH`
   unset until step 6. In the Pro repo create the environment `pro-publish` with required reviewers and the secret
   `PRO_NPM_TOKEN`. Pin `changesets/action@v1` and `emdash-cms/emdash/apps/release-action@main` to commit SHAs (T104).
3. **npm.** Confirm the `@semics-tech` org owns the names `@semics-tech/emdash-events`, `@semics-tech/emdash-esign`,
   `@semics-tech/emdash-events-suite`, `@semics-tech/emdash-events-pro` and `@semics-tech/emdash-esign-pro`
   (publish nothing by hand). Turn on 2FA for publishing.
4. **Lawyer (D4).** Send `docs/legal/brief.md` to counsel; get written answers to its §13 questions and sign-off on the
   consent wording, certificate wording and retention defaults. Any wording change is a normal task before 1.0.0.
5. **Paddle and the licence Worker (T072, R67).** In Paddle create the products and yearly prices (Events Pro 79,
   E-sign Pro 79, Suite Pro 129, Agency 349) and put the price ids in `PADDLE_PRICES`; make checkout send
   `customData: { sites: [...] }`; add a notification destination for `transaction.completed`,
   `subscription.canceled`, `adjustment.created`, `adjustment.updated` at `https://<worker host>/paddle/webhook`.
   Then, in `packages/licence-worker` of the Pro repo: `node scripts/keypair.mjs` (commit `licence/public-key.txt`,
   pipe the private half to `wrangler secret put LICENCE_SIGNING_KEY`); `wrangler d1 create semics-licences` (put the
   id in `wrangler.jsonc`) and `wrangler d1 migrations apply semics-licences --remote` (applies 0001 and 0002);
   `wrangler secret put` each of `PADDLE_WEBHOOK_SECRET`, `PADDLE_API_KEY`, `MAIL_API_KEY` and `ADMIN_TOKEN`
   (`openssl rand -hex 32`; keep it in the password manager); set `MAIL_FROM`, `SUPPORT_EMAIL`,
   `LICENCE_PUBLIC_KEY`; `wrangler deploy` (deploys the `*/15` stuck-event cron too). Support use:
   `curl -H "Authorization: Bearer $ADMIN_TOKEN" "https://<worker host>/admin/licences?email=buyer@example.org"` and
   `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "content-type: application/json" -d
   '{"licenceId":"lic_...","sites":["tickets.example.org"]}' https://<worker host>/admin/licences/sites`.
6. **Pro package access (R67).** For each sale, create an npm granular access token: read-only, packages
   `@semics-tech/emdash-events-pro` and `@semics-tech/emdash-esign-pro` only, expiry at or before the licence's
   `updatesUntil` (or npm's maximum, then renew), and email it to the buyer (the key email tells them it is coming).
7. **Publish the release candidate.** Merge to `main`: the release workflow runs `pnpm release`, which publishes
   `1.0.0-rc.0` under the `rc` dist-tag after the strict dry run. Then set `EMDASH_REGISTRY_PUBLISH=true` and re-run
   the workflow to submit the plugins to the EmDash registry. In the Pro repo run the `pro-release` workflow (it checks
   lockstep with Free first).
8. **Cloudflare staging (T111, from its Notes).**
   1. Cloudflare (Workers Paid, needed for Worker Loader): enable R2 and make sure the account has a workers.dev
      subdomain. Create an API token at My Profile, API Tokens, Custom token, scoped to this account only, with:
      Account / Workers Scripts: Edit; Account / D1: Edit; Account / Workers R2 Storage: Edit; Account / Workers KV
      Storage: Edit; Account / Account Analytics: Read. No zone permissions.
   2. GitHub `semics-uk/emdash-plugins`, Settings, Environments: create `staging` with the secrets
      `CLOUDFLARE_API_TOKEN` (step 1), `CLOUDFLARE_ACCOUNT_ID`, `STAGING_ADMIN_TOKEN` (a fresh `ec_pat_` + 32 random
      base64url characters, never reused) and `PRO_REPO_TOKEN` (fine-grained PAT, Contents: Read on
      `semics-uk/emdash-plugins-pro` only).
   3. Repository variables: `STAGING_URL=https://semics-staging-playground.<subdomain>.workers.dev`,
      `STAGING_ENABLED=true` (`T007_PUBLIC_EVENTS_CPU_MS` optional).
   4. Actions, "Staging nightly", Run workflow (the first deploy provisions D1, R2 and KV; then nightly at 03:17 UTC).
      Tick T111's remaining boxes from the run: green nightly, R27 CPU line, Lighthouse, visitor IP, Phase 2 exit,
      Pro check-in on staging, the token box.
   5. Actions, "Regenerate visual baselines", Run workflow once; commit the PNGs if they differ (T054 baselines).
   6. Keep the nightly green on the RC for a week before step 11.
9. **Upstream bug.** File `docs/upstream/emdash-sandboxed-activate.md` as an issue on the EmDash repository.
10. **Recommended before 1.0.0 final:** a manual screen-reader pass (VoiceOver on iOS, NVDA on Windows) of the booking
    widget and the signing ceremony (SU-NFR-03).
11. **Cut 1.0.0.** On a branch: `pnpm changeset pre exit`, `pnpm version-packages`, set the Pro packages to `1.0.0`,
    open the PR, merge; the workflows publish `1.0.0` under `latest`.
