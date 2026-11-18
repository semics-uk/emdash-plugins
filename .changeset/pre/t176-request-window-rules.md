---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-events-suite": patch
---

Booking-request time windows can now change by weekday, date range and season. An event's requests take
`rules`: the first rule that matches a date (its weekday, a `MM-DD` to `MM-DD` range, and "summer", meaning the
clocks have gone forward) replaces the usual windows that day. For example, Wednesdays from April until the
clocks go back can offer only late windows. Rules are set through the `config/save` route (see the Events docs);
saving the admin panel keeps them. The booking widget and the suite's booking form show only the chosen date's
windows, and checkout refuses a window the date does not offer.
