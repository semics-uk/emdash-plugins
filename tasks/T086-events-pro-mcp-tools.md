---
id: T086
title: "Events Pro: MCP tools"
phase: 5
package: events
edition: pro
status: done
model: sonnet-5.5
size: S
depends_on: [T057, T071]
spec: [EV-FR-18]
---

# T086 · Events Pro: MCP tools

## Definition

List events, availability, find booking, list attendees, check in, cancel and refund (destructive marked), with zod schemas and permissions.

## Model

**Sonnet 5.5**: Thin wrappers over routes.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Each tool registers with its permission
- [x] Destructive tools flagged
- [x] Runtime host consent/permission tests pass

## Implementation (green, then refactor)

- `src/mcp/*.ts`

## Acceptance criteria

- [x] Reuse route handlers
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- Pro code only (R40/R41), in `emdash-plugins-pro` branch `pro-agent-t086`: `packages/events-pro/src/mcp/{tools,routes}.ts`,
  wired in `src/plugin.ts` (object-literal default export with `mcp.tools`, so `emdash-plugin build` writes them into the
  manifest), tests in `tests/mcp.editions.test.ts` (built manifest plus real route dispatch: editor 403, admin 200,
  budgets). Decision recorded as BUILD-PLAN R59 (mirrors E-sign's R55).
- Seven tools, each on a private `pro/mcp/*` route declaring `plugins:manage`: `listEvents` (Free `public/events`),
  `getAvailability` (Free `public/event`), `findBooking` (by ref: Free booking status; by email: up to 20 bookings),
  `listAttendees` (50 a page, no check-in codes), `checkInAttendee` (Pro `checkin/code`, licence-gated; that route now
  also accepts `attendeeId`), `cancelBooking` and `refundBooking` (both `destructive`: Free cancel with Pro's refund
  step, and the bookings page's full refund, now `refundByRef`, which the form and the tool share).
- Deviation: the task said "zod schemas". The schemas are plain JSON Schema so no Zod enters the bundle, as in T096/R55.
- Admin authority over Free's token-authenticated booking routes: the booking read by ref carries the hash of a token
  minted for each call (never stored or returned). The admin may cancel until the event starts (cutoff 0, not the buyer's).
- Free backend unchanged (0 B). Pro backend 203.7 → 206.5 KiB (of 256).
