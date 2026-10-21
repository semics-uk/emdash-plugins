---
id: T055
title: "Events UI: booking widget, status, pass and calendar"
phase: 2
package: events
edition: free
status: in-progress
model: opus-5.5
size: L
depends_on: [T053, T047, T048, T049]
spec: [EU-FR-04, EU-FR-06..08, EU-NFR-01..07]
---

# T055 · Events UI: booking widget, status, pass and calendar

## Definition

`<BookingWidget>` with progressive enhancement (plain form first), `<BookingStatus>`, `<TicketPass>` (text code; QR is Pro) and `<AddToCalendar>`; accessible, ≤ 15 KB client script.

## Model

**Opus 5.5**: Progressive enhancement, accessibility and budget constraints together.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] No-JS booking completes (Turnstile off)
- [ ] With Turnstile on and JS off, the widget explains scripts are needed
- [ ] axe: no serious violations; Lighthouse accessibility ≥ 95
- [ ] Client bundle ≤ 15 KB gzipped (CI check)
- [ ] Errors render next to their fields

## Implementation (green, then refactor)

- `src/astro/BookingWidget.astro`, `src/client/booking.ts`

## Acceptance criteria

- [ ] Works at 320 px
- [ ] Each checkout attempt sends a fresh `idempotencyKey` (32+ random URL-safe characters) to `public/checkout/reserve` (T047); resubmits reuse it
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```
