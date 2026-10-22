---
id: T043
title: "Events: editor panel "Tickets & booking""
phase: 2
package: events
edition: free
status: review
model: sonnet-5.5
size: M
depends_on: [T042, T014]
spec: [EV-US-1, BUILD-PLAN §3.1 Admin]
---

# T043 · Events: editor panel "Tickets & booking"

## Definition

Block Kit editor panel on saved event entries: sale status, ticket-type repeater, capacity, live stats.

## Model

**Sonnet 5.5**: UI composition.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Runtime host `captureEditorDraft`/panel load renders
- [x] Saving the panel persists config
- [x] Stats show reserved/sold

## Implementation (green, then refactor)

- `src/admin/panel.ts`

## Acceptance criteria

- [x] Collections scope set
- [x] Occurrence (date) editing: the admin Event editor (T052) passes occurrences through unchanged; the editor panel owns adding, editing and removing them via `config/save`
- [x] Show event titles where events are listed (T052 lists by id; titles need `content:read`, so read them in one batch per page)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- Panel `tickets` -> private route `editor/tickets`, scoped to the default `events` collection (the manifest is static, so a site that maps another collection must edit the scope; no draft access is requested, no capability added).
- Existing items are flat fields keyed by id; new ones come from repeaters. The Block Kit `FormField` type omits repeaters, so the panel casts; the host validator accepts them (tests run in the real host).
- `saveConfig` gained an optional `onSaved` callback (event as it now stands) so the panel renders after a save without a read back (budget). Save <= 8 calls, load 3; more changes are refused as `TOO_MANY_CHANGES`.
- Event titles: admin event lists (Events and Attendees pickers) do one `content.list` for the mapped collection (first 100 entries), falling back to `info.title`, then the id. The Bookings page lists no events.
- Refusal messages moved to `src/admin/messages.ts` (shared with the T052 editor page; the too-many-changes text no longer says "5 per save").
- Not run: playground e2e (the panel needs a real admin session; host tests cover load, save, validation and budget).
