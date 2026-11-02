---
id: T141
title: "Events panel: add ticket types and dates without repeaters (Block Kit draws none in a form)"
phase: 7
package: events
edition: free
status: in-progress
model: opus-5.5
size: M
depends_on: []
spec: [R92]
---

# T141 · Events panel without repeaters

## Definition

Reported from LMSC staging (EmDash 1.3.1, `@emdash-cms/blocks` 1.3.1): the "Tickets & booking" panel
has no way to add a ticket type, so an event can never get a price. `panelForm()` in
`packages/events/src/admin/panel.ts` adds "New ticket types" and "New dates" as `repeater()` fields
inside a `form()` block. `FormBlockComponent` in `@emdash-cms/blocks` (1.2.0 and 1.3.1) draws each field
through `renderElement`, which returns null for `repeater` ("an admin-authoring element and renders
nothing at runtime"). So both repeaters are invisible, in the content entry's sidebar panel and on
Events → Event editor. Tests passed because they post form values straight to the route.

Replace each repeater with plain fields Block Kit draws: one blank "new ticket type" row (name, price,
capacity) and one blank "new date" row (starts, capacity), added on save. After a save the panel
re-renders with the new item listed and a fresh blank row, so any number can be added one at a time
(up to `MAX_TICKET_TYPES` / `MAX_OCCURRENCES`). Keep the existing rules: a blank row is ignored, a row
without capacity takes the event's.

## Acceptance criteria

- [ ] A test fails today because a panel/editor form contains a field `renderElement` would not draw:
      walk every form the admin builds (panel and Event editor, slot-schedule and dated events) and
      assert each field type is one `@emdash-cms/blocks` renders (no `repeater`).
- [ ] Adding a ticket type through the new fields saves it with name, price (minor units) and
      capacity; blank fields add nothing; the row is gone once `MAX_TICKET_TYPES` is reached.
- [ ] Same for dates (not shown for a slot-schedule event, as now).
- [ ] An e2e or render-level check in the playground shows the "new ticket type" inputs on the panel.
- [ ] Old stored form values (`newTickets` / `newDates` arrays) still parse, so a half-upgraded admin
      does not lose input.
- [ ] Bundle stays inside the 125 KiB budget with the 4 KiB hotfix room (R94, R100).
