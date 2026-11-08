---
"@semics-tech/emdash-events": patch
---

Booking UI design pass (T157). The booking widget is one card with even padding, no boxed groups and a roomier
calendar. The `/booking` page leads with the event, the booked date and time (in the event's time zone, as the
widget writes it) and the place, then the status, reference, order and total; sections are cards. A confirmed booking
has "Print or save as PDF" with a print layout (no buttons or brand bar; reference, session, attendees, total, tickets
and the organiser kept), and the check-in code is smaller, beside its QR. "Cancel booking" moves to the foot of the
page and opens a confirmation first. Deadlines and holds read like the session time ("Tuesday, 10 November 2026 at
12:47"), without "(Europe/London)". `page.brand.address` adds the organiser's address at the foot of the pages.
The day-and-time picker also shows a date that another script restores into its select.
