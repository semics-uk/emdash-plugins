---
id: T082
title: "Events Pro: QR passes and mobile check-in screen"
phase: 5
package: events
edition: pro
status: backlog
model: sonnet-5.5
size: M
depends_on: [T057]
spec: [Free and Pro table]
---

# T082 · Events Pro: QR passes and mobile check-in screen

## Definition

QR codes generated in the browser for ticket passes; a mobile check-in page for staff (code entry and camera scan where supported).

## Model

**Sonnet 5.5**: UI with a library-free QR encoder or a small vetted one.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] QR encodes the attendee code and scans back (decoder in tests)
- [ ] Check-in screen works at 320 px
- [ ] Pending waivers show the sign link

## Implementation (green, then refactor)

- `src/astro/TicketPass.astro` QR, `src/astro/CheckIn.astro`

## Acceptance criteria

- [ ] Pro build only
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```
