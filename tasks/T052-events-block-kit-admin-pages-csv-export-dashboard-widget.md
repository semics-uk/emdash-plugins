---
id: T052
title: "Events: Block Kit admin pages, CSV export, dashboard widget"
phase: 2
package: events
edition: free
status: review
model: sonnet-5.5
size: M
depends_on: [T048, T014]
spec: [EV-FR-11, EV-US-5, EV-US-7]
---

# T052 · Events: Block Kit admin pages, CSV export, dashboard widget

## Definition

Bookings and Attendees pages (search, admin check-in by name or code, undo), CSV export (raw `text/csv`) and the sold/capacity widget.

## Model

**Sonnet 5.5**: UI composition.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Pages load and validate
- [x] Check-in twice shows first check-in time
- [x] CSV escapes commas and quotes
- [x] Widget meters match counters

## Implementation (green, then refactor)

- `src/admin/*.ts`, `src/routes/attendees.ts`

## Acceptance criteria

- [x] Within budget
- [x] Settings page calls `validateMapping` (`src/domain/mapping.ts`) with the `schema:read` collections and renders its `banner`; shows the T040 `encryptionKeyStatus` banner too
- [x] Admin pages built with the `@semics-tech/shared` Block Kit builders (T014), not raw JSON; banners via `notices([...])`
- [x] The editor submits only changed items to `config/save` (bulk edits hit `TOO_MANY_CHANGES` beyond 8 calls, T044)
- [x] Settings page warns when no Turnstile secret is set: checkout then runs without a bot check (T047)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- One private `admin` route (`src/routes/admin.ts`) answers every page, widget and action via `handleAdmin` (`src/admin/pages.ts`). Pages (manifest `admin.pages`): Bookings, Attendees, Event editor, Setup check; widget `sales`.
- Editor: sends every ticket type (an omitted one is deleted by `config/save`) but only changed values differ from storage, so only changed items are written. It reads the event once and passes that state to `saveConfig` (new optional `preloaded` arg, `loadEventState` exported), so a save is 3 reads plus at most 5 writes. `TOO_MANY_CHANGES` shows as "at most 5 ticket types per save". Occurrences are not editable here yet (passed through unchanged).
- CSV (`attendees/export`, raw `text/csv`, admin only) returns one part of up to 100 attendees. The next-part cursor cannot travel in a header, so the Attendees page offers "Download CSV (this page)" per page of 100. A one-click full export of a huge event is a follow-up. The link is absolute (Block Kit requires it), built from the request origin.
- Check-in refuses non-`confirmed` bookings and non-`valid` attendees (pending waiver); a second check-in shows the first time; undo stores `null`. Name search scans at most 4 pages of an event (no name index).
- Event names are not shown (ids only): resolving titles needs a `content:read` call per row.
- Setup page treats a stored secret that comes back as an object (not text) as "unreadable" for the T040 banner; the sandbox has no key-configured flag.
- Widget counters: `reserved` includes `sold`, so held = reserved - sold.
