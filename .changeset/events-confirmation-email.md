---
"@semics-tech/emdash-events": minor
---

Send booking emails and serve calendar files. The `outbox-drain` cron task (every minute) renders the queued confirmation and cancellation emails at send time (the queue holds ids only) and sends one per tick through the shared outbox. The confirmation links to `/booking?ref=…&k=…`, a one-time code (only its hash is stored) that the new `POST public/booking/redeem` route exchanges for a fresh access token, so no access token is ever emailed or put in a URL. `GET public/booking/ics` (15-minute signed link) and `GET public/event/ics` return `text/calendar` in the event's time zone; `public/booking` now returns `calendar: { query }` and each valid attendee's check-in `code` to the token holder. Adds a public route, so the public surface grows by one declared route.
