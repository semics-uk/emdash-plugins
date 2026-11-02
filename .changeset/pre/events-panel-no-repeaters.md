---
"@semics-tech/emdash-events": patch
---

The "Tickets & booking" panel and Events → Event editor can add ticket types and dates again (T141, R92): the admin's Block Kit renderer draws no repeater inside a form, so the "New ticket types" and "New dates" lists were invisible and no event could get a price. Each is now one blank row of plain fields (name, price, capacity; starts, capacity), added on save, with a fresh blank row after each save. Values from an older admin (`newTickets` / `newDates`) still parse.
