---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-events-suite": patch
---

Booking-request time windows can now change by weekday, date range and season. An event's requests take
`rules`: the first rule that matches a date (its weekday, a `MM-DD` to `MM-DD` range, and "summer", meaning the
clocks have gone forward) replaces the usual windows that day. For example, Wednesdays from April until the
clocks go back can offer only late windows. The admin panel has a "rules" field, one rule a line, such as
`WE 04-01..10-31 summer: 15:30-17:00 Late 1, 17:00-18:30 Late 2`. The booking widget and the suite's booking
form show only the chosen date's windows, and checkout refuses a window the date does not offer.
