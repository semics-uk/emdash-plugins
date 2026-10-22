---
id: T085
title: "Events Pro: sales reports"
phase: 5
package: events
edition: pro
status: review
model: sonnet-5.5
size: S
depends_on: [T057, T071]
spec: [EV-FR-19]
---

# T085 · Events Pro: sales reports

## Definition

30-day sales chart and revenue by ticket type in Block Kit charts.

## Model

**Sonnet 5.5**: Aggregation and charts.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Aggregates match fixture bookings
- [x] Chart block validates

## Implementation (green, then refactor)

- `src/admin/reports.ts` (in the Pro repo, `packages/events-pro`: the page and blocks; `src/reports/{rollup,job,export,register}.ts` the rollup, cron, export and wiring)

## Acceptance criteria

- [x] Counters precomputed, not scanned
- [x] Full attendee export that walks the 100-row CSV parts (T052 offers one part per page)
- [x] Reports do not treat the `sold` counter as exact: drift repair can over-count it briefly between continue's confirm and `confirmSold` (T057 review F15); revenue and sold figures come from confirmed bookings or are labelled approximate
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

All code is in the Pro repo (worktree `pro-agent-t085`); no public (MIT) code changed, so Free Events stays at its size.

- **Counters precomputed:** a Pro cron task `reports-rollup` (every minute, scheduled on first visit to the page or by the one-shot `ensure-schedules`; flag `reports:scheduled:v1`) re-scans confirmed bookings per event 100 at a time, resuming from a KV cursor, at most 8 bridge calls a tick (an idle tick is one KV read), and writes one `report_events` document per event (totals, by ticket type, last 400 UTC days). A pass repeats 15 minutes after the last. Pages read those documents (overview 2 calls, event page 3). Roll-ups at confirm/cancel time would need a Free hook (Free has no headroom), so the periodic re-scan is also what picks up cancellations and refunds; the page says figures are approximate and "as of" the scan.
- **`sold` is never used:** tickets and revenue come from confirmed bookings only (revenue after discounts; the ticket-type table is before discounts); partial refunds are not subtracted (labelled).
- **Charts:** shared `timeseriesChart` (tickets per day, revenue per day, 30 days zero-filled) and `pieChart` (revenue by type), validated with the host's `validateBlocks` in unit and edition tests. Mixed-currency sites sum the first event's currency and warn.
- **Full export:** Pro action `reports.export_step` reads one 100-row part per click with Free's `exportAttendeesCsv` (5 calls) into `report_exports`; when done, `GET pro/reports/export?eventId=` joins the parts into one CSV (2 calls). Imports Free's `attendees.ts`/`csv.ts` by path like `free.ts` does (no Free change).
- `events/reports` is `in-flight` in `PRO_OPERATIONS`, so `licence.gate` lets it through without a key (owners keep their figures after a lapse).
- Pro bundle: `plugin.mjs` grew from about 102.8 KiB to 118.2 KiB (limit 256 KiB, R43).
- Follow-ups: skip re-scanning closed events; row count in export ignores line breaks inside quoted cells (cosmetic).
