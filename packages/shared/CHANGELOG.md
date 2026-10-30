# @semics-tech/shared

## 0.1.0-rc.1

### Minor Changes

- b037939: Attendee signing list on the booking page (T133, R95; the routes behind it are Events Pro's). When Events Pro describes a waiver booking's seats, `/booking` lists every attendee as Signed or Waiting, with a "Sign now on this device" button (the attendee signs on the buyer's phone or a front-desk tablet; a minor's guardian signs for them), "Resend invitation" for adults invited by email, and a form to correct the names and emails of attendees who have not signed until the site's cutoff. Every action is a plain form post: no JavaScript is needed. Free shows nothing new. E-sign's `public/envelopes/from-intent` honours two optional intent fields (protocol §5.1, §8.1): `resend: true` emails the open envelope's invitation again with a fresh link, and `replace: true` voids the open envelope for the seat (audited as the integration) unless it already names that signer, and never creates one. An older e-sign ignores both.

### Patch Changes

- a76dba3: The Free Events backend is 4.1 KiB smaller (120.9 KiB, R100, T136), so it again has room for a hotfix under its 125 KiB budget. Nothing changes for sites or buyers: code that the core carried more than once (status lists, sorting, booking lookups, new booking documents, emailed link codes, cron state, time formatting) now lives in one place. `@semics-tech/shared` adds `utcParts`, `pad2`, `validZone` and exports `WEEKDAYS`.

## 0.0.1-rc.0

### Patch Changes

- 20f9c38: Unsigned envelopes now end: an hourly `expire` task closes `sent` and `in_progress` envelopes past their `expiresAt` (audited `envelope.expired`), so retention can purge them. Deletion on request by signer email also finds drafts (new indexed `signerEmail`). Automatic reminders stay Pro.
- 7868030: Envelopes with several signers (made by E-sign Pro) are handled safely by the Free core: each signer's first view and decline is recorded as their own audit event (`data.signer`), Free never completes such an envelope (a signature is refused with `ENVELOPE_CLOSED` and nothing is written, so a site switched back from Pro keeps a half-signed envelope intact), the signed PDF and certificate list every signer, and the signing page shows a waiting state while other signers still have to sign. New `ceremonyHandlers` seam (`src/seams.ts`) for an edition that routes several signers, a `SIGNING_OUT_OF_TURN` error code, and the schedule flag moves to v7 for the Pro `reminders` task.
