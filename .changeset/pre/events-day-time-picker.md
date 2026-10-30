---
"@semics-tech/emdash-events": minor
---

Day-then-time picker: for a slot schedule, or any event with two or more dates on one day, the booking form shows a month calendar of the days that have slots, then the chosen day's times with the places left; full times are shown as full and cannot be chosen, closed ones are not shown. Earlier and Later links page by month (`booking_from` query parameter). Without JavaScript the form lists the month's times grouped by day. Keyboard and screen-reader accessible (roving focus over days and times, labelled controls), right to left included. `public/event` takes an optional `from` and answers up to 200 upcoming dates, with `more` and `slots` flags. The event calendar file, counter repair and `config/get` now read upcoming dates rather than an event's oldest ones.
