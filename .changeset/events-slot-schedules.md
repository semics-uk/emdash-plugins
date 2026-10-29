---
"@semics-tech/emdash-events": minor
---

Slot schedules: an event can sell several time slots a day from one schedule (days, start times, minutes per slot, places, days bookable ahead, closed dates) set in the editor panel, local to the event's time zone. The `occurrences` job keeps every slot inside the book-ahead window, skips a slot time that a clock change removes and takes the first of a repeated one. Changing the schedule never moves or deletes a booked slot; unbooked slots that no longer fit leave sale at once and are deleted shortly after. The panel's **Show day** closes, reopens or changes the places of one day's slots without touching the schedule, and refuses to close a booked slot, listing its bookings. `public/event` now lists upcoming dates only.
