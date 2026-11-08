---
"@semics-tech/emdash-events-suite": patch
---

Booking UI design pass (T157). `<BookingWithWaiver>` is one card: one attendee row shows, with "Add another person"
up to the limit (without JavaScript the other rows sit under "Add more people"), and a summary of the date, the
people and the total sits above Book. After a refused booking the calendar shows the chosen day and its times again,
and every row that was filled. An attendee's email is labelled "Email (needed for adults)". On the waiver page the
session and "signing for" lines share one card, and the signing form is a card that lines up with it.
