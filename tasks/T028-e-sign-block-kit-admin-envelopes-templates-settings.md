---
id: T028
title: "E-sign: Block Kit admin (envelopes, templates, settings)"
phase: 1
package: esign
edition: free
status: done
model: sonnet-5.5
size: M
depends_on: [T021, T022, T014]
spec: [ES-FR-11, ES-US-4]
---

# T028 · E-sign: Block Kit admin (envelopes, templates, settings)

## Definition

Envelopes table with status filter and detail with audit timeline; template editor with preview; settings page.

## Model

**Sonnet 5.5**: UI composition with builders.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Runtime host admin helpers load each page and validate Block Kit
- [x] Form submit creates a template
- [x] Envelope detail shows audit events in order

## Implementation (green, then refactor)

- `src/admin/*.ts`, `admin` route

## Acceptance criteria

- [x] Pages declared in manifest
- [x] Settings page shows the `encryptionKeyStatus()` banner (`src/domain/encryption-key.ts`) when `EMDASH_ENCRYPTION_KEY` is missing; saving a secret maps `isEncryptionKeyMissingError` to that banner
- [x] Admin pages built with the `@semics-tech/shared` Block Kit builders (T014), not raw JSON; banners via `notices([...])`
- [x] Admin "resend invitation" for a `sent` envelope whose invitation failed to queue (T027: `send` errors after storing the signer)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- Pages `/envelopes` (status filter, detail with audit timeline, create draft, send, void, resend invitation), `/templates` (list, create form, editor with preview, archive, new-envelope form) and `/settings` (plain settings and secret inputs, writes only what changed, at most 6 per save). All through one private `admin` route; no widget.
- New private routes: `envelopes/resend` and `envelopes/void`. Resend works for `sent` envelopes whose outbox row `invite-<signerId>` is missing or `failed`; it rotates the signer token (only the hash is stored), re-queues, and appends a missing `envelope.sent` audit event. Audit seq starts at 0, so `sent` is seq 1.
- Budget: list 3, detail 3-4, void 4+3, resend 6+1 (repair 9), create 3+4, settings 1+6. `envelopes/send` is 9 inside the route (T027), so after Send the admin shows a short confirmation with an "Open envelope" button rather than re-reading (the full detail would be 13).
- The sandbox cannot read `EMDASH_ENCRYPTION_KEY`, so the banner (`encryptionKeyStatus(null)` text) shows when a secret save fails with the host's encryption error (`isEncryptionKeyMissingError`, now also matching `PluginSettingEncryptionError`) or when a stored secret comes back unreadable.
- Outbox banner (no transport, failed count) uses `outboxReport`; tested with a fake context since the test host has a transport.
- Never shown: signing tokens, `tokenHash`, `piiSalt`, audit `personal` values or commitments. The detail shows the signer's name and email (needed to resend).
- Follow-ups: no widget; the envelope list is the newest 100 with no paging; Pro settings (reminders, OTP) stay in the host's settings panel; no coverage thresholds were checked for `src/admin`.
