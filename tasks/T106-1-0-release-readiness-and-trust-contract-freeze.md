---
id: T106
title: "1.0 release readiness and trust-contract freeze"
phase: 7
package: repo
edition: free
status: review
model: opus-5.5
size: S
depends_on: [T100, T101, T102, T103, T104, T105]
spec: [Phase 7 exit]
---

# T106 · 1.0 release readiness and trust-contract freeze

## Definition

Freeze both trust contracts, run every gate, confirm the PRD feature checklists, cut 1.0 release candidates.

## Model

**Opus 5.5**: Final judgement call.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Every PRD requirement maps to a passing test (traceability report)
- [x] Trust-contract snapshot test added

## Implementation (green, then refactor)

- `scripts/traceability.mjs`

## Acceptance criteria

- [x] Release candidates built
- [x] The scaffold `hello` route is removed from the Events core before the route list freezes (T057 review F14)
- [x] Licence Worker support tooling (T072): issue the key for a `needs_sites` sale and change a licence's hostnames without hand-editing D1; an alert for webhook events stuck in `processing`; a decision on checking `semreg_` registry tokens (proxy vs manual npm access)
- [x] Decide on the admin "Waitlist" page from BUILD-PLAN (not built in T081): build it or drop it from the 1.0 scope and the docs
- [x] Decide whether custom attendee answers (R52) should show on the booking page and in emails, and whether waitlist-offer bookings need them; record as a §12 row (follow-up from T080)
- [x] Decide and record (§12) the uploaded-PDF follow-ups from T094: a several-signer PDF send route, offering PDF templates to integrations, self-serve and bulk send, and deleting unreferenced pdf_files chunks
- [x] Decide whether the outbox drain's 2 messages a minute is acceptable for Events Pro broadcasts (a 500-recipient broadcast takes ~4 h) or needs a faster Pro drain; record as a §12 row (follow-up from T083)
- [x] Decide whether the suite's pages (BookingWithWaiver, /_events/waiver, /_events/templates) get translations before 1.0; record as a §12 row (follow-up from T102)
- [x] Full playground e2e passes on main after T100 (T100 skipped it; the reserve ipSalt write is the change near it)
- [x] Bump vitest to ≥4.1.12 (dev-only audit advisory, T100) and re-run verify in both repos
- [x] Decide whether E-sign Pro's PDF active-content refusal should also cover GoToR, GoToE and embedded files (accepted at severity 4 in tasks/reviews/security.md); record as a §12 row
- [x] Pro pro.json drops the Free manifest's new sections and release fields (drop: ["sections", "release"]) before any Pro registry validate or publish (follow-up from T103)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```

## Notes

- **Report:** `tasks/reviews/release-1.0.md` (go/no-go checklist with evidence, post-1.0 list, owner actions including
  T111's). Verdict: code go; publishing owner-gated (DID, GitHub/npm, lawyer sign-off, Cloudflare staging setup).
- **Decisions R64–R75** (BUILD-PLAN §12): trust-contract snapshots and `release.requires` (R64), RC via Changesets
  `rc` pre mode, products no longer private, Pro `1.0.0-rc.0` in lockstep (R65), traceability rules (R66), licence
  Worker support routes + stuck alert + manual npm access for 1.0 (R67), no admin Waitlist page (R68), answers
  export-only (R69), PDF follow-ups post-1.0 (R70), 2 mails/min accepted (R71), suite pages English (R72), PDF
  GoToR/GoToE/embedded files accepted (R73), Pro drops listing but keeps `release.requires` (R74), vitest 4.1.12 (R75).
- **Traceability:** PRDs live in Claude Docs, so their 108 FR/NFR ids were copied into `docs/requirements/prd.json`.
  `node scripts/traceability.mjs --pro <Pro dir>`: 107 traced, SU-FR-13 not applicable. Gaps found and closed: 17 ids
  were covered but unnamed (titles tagged), EU-NFR-01/02 labels were swapped, four tests were wrongly named EU-NFR-05,
  and EU-NFR-05 (theming) had no test or docs (now `scripts/theming.test.mjs` + a table in `site-pages.md`; the
  check-in accent default changed from `#1d4ed8` to `#0b57d0`). EV-NFR-07 found both manifests lacked §9's
  `release.requires`: added.
- **Hello route:** already removed in T100 (security.md finding 12); absent from `trust-contract.json`.
- **Changesets pre mode** moves consumed changesets to `.changeset/pre/`; `scripts/changeset-check.mjs` now reads them.
  `@semics-tech/shared` was bumped to `0.0.1-rc.0` by Changesets (private, harmless).
- **Pro branch `pro-agent-t106`:** licence Worker `src/admin.ts`, migration `0002_stuck_alerts.sql`, cron trigger,
  key-email wording; `pro.json` drops; Pro trust contracts (build suite; `SEMICS_WRITE_TRUST_CONTRACT=1` rewrites);
  vitest 4.1.12; versions `1.0.0-rc.0`. Pro tests run against the main checkout's Free core, which lacks this
  branch's `release.requires` until it lands (the generator test covers the keep-requires path with a fixture).
- **Evidence:** red runs seen for every test commit (traceability 17 untraced; trust contract missing snapshot;
  manifest-requires undefined; theming conflicting default; licence Worker 9 failing; generator 3 failing; Pro
  trust contract missing; release-candidate 2 failing; changeset-check missing export). Public `pnpm verify` green;
  full playground e2e 112 passed (`E2E_PORT=4473`); Pro `pnpm verify` green.
- **Sizes:** Free Events backend 118,756 B (unchanged, budget 118,784), Free E-sign 107,836 B (105.3 KiB); Events Pro 207.2 KiB,
  E-sign Pro 191.3 KiB (unchanged).
