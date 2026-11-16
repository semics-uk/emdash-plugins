---
"@semics-tech/emdash-events": patch
---

Booking requests (T174a). An event can take requests for a preferred date and a named time window instead of a fixed date: set the windows, days, days ahead, notice and closed dates under **Booking requests** in the Tickets & booking panel. The booking widget then offers only those dates and the windows, and posts `request: { date, window }` to `public/checkout/reserve`, which checks them in the event's time zone. A request always waits for approval (the deadline is never past the window's start) and its emails say "time to be agreed". On the Bookings page a request shows what was asked for, and its Approve opens **Confirm time**, which confirms the booking with the agreed time; the booking page, calendar file, emails and cancel cutoff then use that time.
