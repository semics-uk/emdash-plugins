---
id: T050
title: "Events: confirmation email and calendar routes"
phase: 2
package: events
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T048, T015, T018]
spec: [EV-US-3, EV-FR-08, EV-FR-09]
---

# T050 · Events: confirmation email and calendar routes

## Definition

Confirmation email with links, and `public/booking/ics` / `public/event/ics` raw `text/calendar` behind signed links.

## Model

**Sonnet 5.5**: Wiring existing modules.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Email contains booking, ticket and ICS links and no attachment
- [ ] ICS route returns valid calendar with correct TZID
- [ ] Expired signed link fails

## Implementation (green, then refactor)

- `src/emails/confirmation.ts`, `src/routes/ics.ts`

## Acceptance criteria

- [ ] Snapshots in 3 zones
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
