---
"@semics-tech/emdash-events": patch
---

Phase 2 review fixes. The checkout endpoint and the booking page's cancel and redeem forms refuse cross-site posts themselves (403): EmDash turns Astro's `security.checkOrigin` off, so they had no CSRF protection before. `public/event/ics` answers `NOT_FOUND` for an event in draft, unpublished, orphaned or without a config, like `public/event`. Cancelling a booking whose earlier cancel died after claiming it no longer releases its seats a second time (drift repair settles them). The outbox drain skips its give-up log on a tick that already used all 10 bridge calls.
