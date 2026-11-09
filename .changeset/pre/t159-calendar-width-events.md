---
"@semics-tech/emdash-events": patch
---

The day calendar of `<BookingWidget>` (slot schedules and the T130 day picker) no longer stretches with a wide host
column: it stays at most `--events-calendar-max` wide (default 26rem, days of about 54px), with the month and its
Earlier / Later links over it, while the rest of the widget fills the column. On a phone it still takes the whole form
(T159).
