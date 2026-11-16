---
"@semics-tech/emdash-events-suite": patch
"@semics-tech/emdash-events": patch
---

`<BookingWithWaiver>` now takes booking requests (T174a), as Events' `<BookingWidget>` does: for an event set up for requests it shows a select of the dates the event takes (allowed weekdays, notice, days ahead, without closed dates, from Events' `requestDates`) and the time windows as radios, and posts `request` instead of a date, so the booking waits for the organiser with "Request sent: we'll confirm a time with you." on the booking page. It works without JavaScript, the waiver steps are unchanged, and a refused form keeps the chosen window. In the Events panel, the **Requests: days** field (and the schedule and requests error messages) now show the comma list it takes, `MO,TU,…`, instead of a `MO-SU` range it refused.
