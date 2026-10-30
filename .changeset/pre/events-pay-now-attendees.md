---
"@semics-tech/emdash-events": patch
---

"Pay now" keeps the attendees typed at checkout (T134, R101): continuing a booking that awaits payment without naming attendees (the booking page's Pay now, including Events Pro's approved booking whose saved card was refused) writes back its stored seats (names, emails, under-18 flags, waiver signatures) and only re-runs the payment step; a booking with no seats stored yet still names them after the buyer. The day-then-time picker pages on its own `booking_from.<eventId>` query parameter, so two booking widgets on one page page independently, with or without JavaScript. The booking page names each ticket type ("3 × Class place") instead of showing its id.
