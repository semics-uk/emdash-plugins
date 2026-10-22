---
id: T064
title: "Events: receipt route and waiver-gated check-in"
phase: 3
package: events
edition: pro
status: in-progress
model: opus-5.5
size: M
depends_on: [T063, T071, T118]
spec: [EV-FR-12, SX-FR-04]
---

# T064 · Events: receipt route and waiver-gated check-in

## Definition

`signatures/receipt` verifies and records receipts, advances bookings, and check-in refuses attendees whose waiver is pending.

## Model

**Opus 5.5**: Protocol verification with state changes.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Valid receipt confirms the booking
- [ ] Forged or replayed receipt rejected
- [ ] Pending attendee refused at check-in with the signing link
- [ ] Idempotent on repeat

## Implementation (green, then refactor)

- `src/routes/receipt.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Check-in refuses attendees whose booking is not `confirmed` (T049 does not mark attendee docs on cancel)
- [ ] On the Events return page, read `#receipt=` from `location.hash`, clear it with `history.replaceState`, POST it to `signatures/receipt`; call `public/receipts/lookup` later for `pdfSha256` (null in the redirect receipt); an Events page embedding `<SigningCeremony>` redirects to `ceremonyRedirect(view)` after a sign/decline post (T062)
- [ ] When receipts arrive, move the booking out of `awaiting_signature` (continue re-issues fresh intents while it waits, T063)
- [ ] R43 in the Pro repo first: `pro-kit` build suite uses a 256 KiB Pro ceiling per backend (Free stays ≤ 104 KiB), validates Pro structure without the registry size check, and asserts the first invocation of the Pro backend stays within the 50 ms CPU budget
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
