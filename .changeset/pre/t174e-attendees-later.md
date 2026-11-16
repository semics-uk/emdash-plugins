---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-events-suite": patch
---

Booking requests: attendees after approval (T174e, with Events Pro). `<BookingWithWaiver>` books a waiver event that takes requests with a ticket count instead of attendee rows, and says the names come once the time is confirmed. On the booking page a confirmed request's seats that have no name yet ask for one (no **Sign now** for them), and the attendee form can mark each person under 18. Nothing changes for other bookings.
