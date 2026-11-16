---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-events-suite": patch
---

Per-person add-ons (T174d, with Events Pro): a booking line marked as an add-on (for example quad trekking at a price a person) counts on its own ticket type but not on the event or date capacity, makes no attendee or waiver seat, and is left out of the seat counts in emails. `<BookingWidget>` and `<BookingWithWaiver>` list add-ons under the tickets, each capped by the places chosen. Nothing changes for events without add-ons.
