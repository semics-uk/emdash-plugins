---
id: T119
title: "Integration: hardening from the Phase 3 review"
phase: 6
package: suite
edition: free
status: in-progress
model: opus-5.5
size: S
depends_on: [T067]
spec: [SX-FR-04, SX-FR-05, EV-FR-12, R5, R44]
---

# T119 · Integration: hardening from the Phase 3 review

## Definition

The Severity 3 and 4 findings of the Phase 3 gate review (`tasks/reviews/phase-3.md`) that no other task
owns. None is exploitable today. The Pro halves live in the Pro repo (`packages/events-pro/src/waivers/`),
the seams here, test-first as usual.

## Model

**Opus 5.5**: Protocol and cross-core behaviour, each path inside the 10-call budget.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] (F5) An adult who signed their emailed waiver without JavaScript (or closed the tab on the redirect) is still recorded: the door link reconciles a `completed` envelope (e.g. the Pro door link also carries a lookup request and `/_events/sign` forwards the receipt when from-intent answers `completed`), and/or `public/booking` lists the pending email refs of a confirmed waiver booking
- [ ] (F6) After a switch from Pro to Free, continuing a booking still `awaiting_signature` keeps its stored attendees and receipts (today Free replans them in the buyer's name), and attendees left `pending` by a waiver can be checked in on Free (no door link and no receipt route exist there)
- [ ] (F7) Once a booking is `awaiting_signature`, continue refuses to change an attendee's name, email or `minor` flag for a seat that already has an envelope (today a buyer can re-describe unsigned seats mid-flow; e-sign no longer hands such an intent a signing token, T067 F2)
- [ ] (F8) The emailed-adult invitations a single order can make e-sign send are bounded (seats per order and the per-IP reserve limit today); decide and test a per-booking cap or document it as accepted
- [ ] (F11) `safeReturnPath` (suite) and `safeReturnTo` (Events) never return a path starting with `//` (`/.//evil.example`, `/%2e//evil.example`); today the error-location helpers reparse it, which is what keeps it on the site
- [ ] (F13) The waiver page's retry cookie (`semics_waiver_access_<ref>`) is cleared once signing proceeds

## Implementation (green, then refactor)

- `packages/events-suite/src/astro/lib/{flow,form}.ts`, `packages/events/src/astro/lib/{receipt,widget}.ts`,
  `packages/events/src/routes/{booking,checkout-continue,attendees}.ts`; Pro `src/waivers/door.ts`

## Acceptance criteria

- [ ] Every test above passes; budgets asserted (≤ 10 bridge calls, target 8)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
```
