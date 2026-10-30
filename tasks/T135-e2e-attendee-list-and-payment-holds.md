---
id: T135
title: "Playground e2e: attendee signing list, approval and payment holds"
phase: 7
package: playground
edition: pro
status: in-progress
model: opus-5.5
size: M
depends_on: []
spec: [R95, R97, R98]
---

# T135 · Playground e2e for the new booking features

## Definition

T133 (attendee list) and T132 (payment holds) were tested by unit and editions tests only. Add Playwright
specs in `apps/playground/e2e/` that run the real flows on the playground with the Pro builds (on a
`*.workers.dev`-style host or the playground's existing Pro setup) and Stripe faked the way existing
payment e2e specs do: (1) waiver booking → booking page lists attendees Signed / Waiting; Sign now signs
one on the same page; Resend; edit a name before the cutoff, refused after; no-JS variant. (2) approval
event, free booking → Awaiting approval → admin Approve → confirmed; Decline path; expiry via the sweeper.
(3) paid approval event → authorised hold → Approve captures; Decline releases; saved-card path with a
refused charge → Pay now → confirmed. (4) slot schedule + day/time picker booking end to end. Axe on the
new pages. Fix any bug found (test-first, in the owning package).

## Acceptance criteria

- [ ] Specs for flows 1-4 pass locally; axe clean; 320 px layout
- [ ] Bugs found are fixed test-first and listed in Notes
- [ ] Meets the Definition of Done (both repos' `pnpm verify` if Pro code changes)
