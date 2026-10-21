---
"@semics-tech/emdash-events": minor
---

Add `<BookingWidget>`, `<BookingStatus>`, `<TicketPass>` and `<AddToCalendar>` to the `./astro` entry. The widget is a plain form that books without JavaScript, shows errors next to their fields, sends a fresh idempotency key per attempt and adds Turnstile when a site key is set; a 2 KB client script enhances it. `callPublicRoute()` now reports a route's own `{ ok: false }` answer as an error (with its validation issues), so the no-JS checkout no longer treats a refused reservation as a booking.
