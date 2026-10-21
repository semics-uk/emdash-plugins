---
"@semics-tech/emdash-events": minor
---

Add `public/checkout/continue`: authenticated by the booking ref and access token in the body, it writes the attendees, confirms free bookings (counting the seats as sold) and queues the confirmation email, returning `next: { type: "done" }`. Idempotent: a replay writes nothing. A lapsed or claimed hold answers `HOLD_EXPIRED`; the Free edition refuses paid bookings with `PAYMENT_FAILED`. Adds the shared booking state machine (`src/domain/booking-state.ts`).
