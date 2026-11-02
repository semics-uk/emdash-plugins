---
id: T141
title: "Events panel: add ticket types and dates without repeaters (Block Kit draws none in a form)"
phase: 7
package: events
edition: free
status: review
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

- [x] A test fails today because a panel/editor form contains a field `renderElement` would not draw:
      walk every form the admin builds (panel and Event editor, slot-schedule and dated events) and
      assert each field type is one `@emdash-cms/blocks` renders (no `repeater`).
- [x] Adding a ticket type through the new fields saves it with name, price (minor units) and
      capacity; blank fields add nothing; the row is gone once `MAX_TICKET_TYPES` is reached.
- [x] Same for dates (not shown for a slot-schedule event, as now).
- [x] An e2e or render-level check in the playground shows the "new ticket type" inputs on the panel.
- [x] Old stored form values (`newTickets` / `newDates` arrays) still parse, so a half-upgraded admin
      does not lose input.
- [x] Bundle stays inside the 125 KiB budget with the 4 KiB hotfix room (R94, R100).

## Notes

- New fields: `nt_name`, `nt_price`, `nt_capacity` (ticket type) and `nd_start`, `nd_capacity` (date, not on a
  slot-schedule event). The capacity label says a blank one takes the event's. Rows of an older admin's
  `newTickets` / `newDates` arrays are still added beside the flat row.
- Fresh blank row after a save: `FormBlockComponent` keeps its `values` state (and the inputs are uncontrolled)
  for as long as React keeps the form mounted, keyed by `block_id`. A fixed id would keep "VIP" in the blank
  row and add it again on the next save. So a successful save renders the form as `tickets.<rev>` (`newId()`);
  a refused or empty save keeps the incoming block id, so what the admin typed stays. The Event editor page's
  `panelPage` now appends the panel's own block id (`event:<id>:<n>:tickets.<rev>`); dispatch still reads the
  event id from the second segment. The first load is still `tickets`, which Pro's `questions.editions` test asserts.
- Render-level check: `tests/admin/panel-fields.render.test.ts` runs in a new Node vitest project `admin-render`
  (React and kumo do not load in workerd). It uses a new test-only helper `@semics-tech/shared/testing/blocks`
  (`formFields`, `undrawnFields` via the real `renderElement`, `renderBlocks` via `BlockRenderer` +
  `react-dom/server`). React is resolved next to `@emdash-cms/blocks` (its peers), so no package gained a
  dependency; adding react as a devDependency re-resolved unrelated peers in the lockfile, so I did not.
  The testing-boundary test covers the new subpath.
- Deviation: the render check lives in `packages/events`, not an e2e in the playground. The admin UI needs a
  signed-in session (the production build has no bypass) and no playground port was assigned. Rendering the
  panel's real blocks through the admin's renderer is the same check without the browser.
- Follow-up (Pro): `events-pro/src/questions/panel.ts` adds questions through a `repeater("newQuestions", ...)`
  in a form, so the same bug hides "New questions" in the admin. Needs the same flat-row treatment.
