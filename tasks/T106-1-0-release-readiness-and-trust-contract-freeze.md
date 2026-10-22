---
id: T106
title: "1.0 release readiness and trust-contract freeze"
phase: 7
package: repo
edition: free
status: backlog
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

- [ ] Every PRD requirement maps to a passing test (traceability report)
- [ ] Trust-contract snapshot test added

## Implementation (green, then refactor)

- `scripts/traceability.mjs`

## Acceptance criteria

- [ ] Release candidates built
- [ ] The scaffold `hello` route is removed from the Events core before the route list freezes (T057 review F14)
- [ ] Licence Worker support tooling (T072): issue the key for a `needs_sites` sale and change a licence's hostnames without hand-editing D1; an alert for webhook events stuck in `processing`; a decision on checking `semreg_` registry tokens (proxy vs manual npm access)
- [ ] Decide on the admin "Waitlist" page from BUILD-PLAN (not built in T081): build it or drop it from the 1.0 scope and the docs
- [ ] Decide whether custom attendee answers (R52) should show on the booking page and in emails, and whether waitlist-offer bookings need them; record as a §12 row (follow-up from T080)
- [ ] Decide and record (§12) the uploaded-PDF follow-ups from T094: a several-signer PDF send route, offering PDF templates to integrations, self-serve and bulk send, and deleting unreferenced pdf_files chunks
- [ ] Decide whether the outbox drain's 2 messages a minute is acceptable for Events Pro broadcasts (a 500-recipient broadcast takes ~4 h) or needs a faster Pro drain; record as a §12 row (follow-up from T083)
- [ ] Decide whether the suite's pages (BookingWithWaiver, /_events/waiver, /_events/templates) get translations before 1.0; record as a §12 row (follow-up from T102)
- [ ] Full playground e2e passes on main after T100 (T100 skipped it; the reserve ipSalt write is the change near it)
- [ ] Bump vitest to ≥4.1.12 (dev-only audit advisory, T100) and re-run verify in both repos
- [ ] Decide whether E-sign Pro's PDF active-content refusal should also cover GoToR, GoToE and embedded files (accepted at severity 4 in tasks/reviews/security.md); record as a §12 row
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```
