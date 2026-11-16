---
"@semics-tech/emdash-events": patch
---

The booking page shows another time the organiser proposed for a booking request (Events Pro, T174c): the proposed time in the event's time zone, the date to answer by, and two buttons, **Accept this time** and **That doesn't work**. Both are plain forms that post back to `/booking` (no JavaScript needed) and call Events Pro's `public/booking/request/accept` and `.../refuse` with the browser's booking cookie. `BookingStatus` takes a new `proposalAction` prop for where they post; without it the proposal is shown without the buttons. English and Arabic text.
