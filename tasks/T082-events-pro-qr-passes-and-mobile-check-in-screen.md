---
id: T082
title: "Events Pro: QR passes and mobile check-in screen"
phase: 5
package: events
edition: pro
status: done
model: sonnet-5.5
size: M
depends_on: [T057, T071]
spec: [Free and Pro table]
---

# T082 · Events Pro: QR passes and mobile check-in screen

## Definition

QR codes generated in the browser for ticket passes; a mobile check-in page for staff (code entry and camera scan where supported).

## Model

**Sonnet 5.5**: UI with a library-free QR encoder or a small vetted one.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] QR encodes the attendee code and scans back (decoder in tests)
- [x] Check-in screen works at 320 px
- [x] Pending waivers show the sign link

## Implementation (green, then refactor)

- `src/astro/TicketPass.astro` QR, `src/astro/CheckIn.astro`

## Acceptance criteria

- [x] Pro build only
- [x] Check-in refuses attendees whose booking is not `confirmed` (T049)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```

## Notes

- Decision R54 (BUILD-PLAN §12). The QR encoder is Pro code, so it is in the Pro repo
  (`packages/events-pro/src/checkin/qr.ts`: byte mode, level M, versions 1-10, lowest-penalty mask, 3.5 KiB
  minified), not in the browser. Pro's `public/booking` adds `qr: { size, bits }` to each pass (0 calls, no licence
  check) and `<TicketPass qr>` draws it as an SVG (`src/astro/lib/pass.ts` `qrPath`, which drops malformed input).
  **Deviation:** the Definition says "generated in the browser". The site's own core generates the matrix, so no third
  party sees a code and the browser downloads no encoder.
- Check-in screen: `/_events/check-in` (`src/astro/CheckIn.astro`, injected by the Free integration, MIT) plus
  `src/client/checkin.ts`. It posts to the Pro private route `checkin/code` with the admin session and
  `X-EmDash-Request`. The route is licence-gated new work (at most 5 calls), runs Free's `checkIn` (so a booking that
  is not `confirmed` is refused) and adds the door signing link for a pending waiver. Only a link to this site's
  `/_events/sign` is rendered. The camera uses `BarcodeDetector` where the browser has it; elsewhere staff type the
  code. The screen needs JavaScript; the Block Kit Attendees page is the no-JS and Free path. On Free the route does
  not exist and the screen says it needs Events Pro.
- Free Events backend unchanged: 115.9 KiB (`dist/plugin.mjs`). Events Pro backend: 197.5 KiB (was 192.9; ceiling 256).
- Tests. Pro: `tests/checkin.unit.test.ts` decodes every version with jsQR (new Pro dev dependency, `jsqr@1.4.0`);
  `tests/checkin.editions.test.ts` covers QR passes within budget, check-in, a second scan, not confirmed, waiver
  sign link, the licence, and Free. Public: `tests/ui/pass.test.ts`, `tests/ui/checkin.test.ts`, the integration
  and client-bundle tests, and the playground `e2e/t082-check-in.spec.ts`. In that spec, route mocks stand in for
  Pro's answers, because the playground is Free only.
- The Pro lockfile also picked up peer-hash churn from `pnpm add` (resolved against the linked public checkout).
- Follow-up: an end-to-end run of the screen against a real Pro build needs a Pro playground (none exists yet).
