---
"@semics-tech/emdash-events": minor
---

Booking approval and admin notifications: an event can require each booking to be approved (panel field **Approval hours**, 0 = off; default deadline 48 hours, never past the date's start). A finished checkout then waits as **Awaiting approval** with its places reserved; admins approve or decline it (with an optional reason) on the Bookings page, and a request not decided in time expires and frees its places. The buyer is emailed when the request arrives, is declined or expires, and gets the usual confirmation with its calendar link when approved. New settings **Admin notification emails** and **Notify admins about** (booking requests, all bookings, or nothing) email up to five admins with a link to the Bookings page. The **Event editor** admin page now opens the full Tickets & booking panel for any collection. New booking statuses `awaiting_approval` and `declined`.
