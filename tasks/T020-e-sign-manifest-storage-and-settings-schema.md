---
id: T020
title: "E-sign: manifest, storage and settings schema"
phase: 1
package: esign
edition: free
status: review
model: sonnet-5.5
size: S
depends_on: [T003, T010]
spec: [ES manifest, BUILD-PLAN §3.2]
---

# T020 · E-sign: manifest, storage and settings schema

## Definition

Declare the v1 trust contract (capabilities, allowed hosts, every public route), storage collections with indexes, and the settings schema (sender name, consent wording, expiry days, retention).

## Model

**Sonnet 5.5**: Declarative configuration.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Manifest validates
- [x] Runtime host: each declared collection accepts a document and queries by its indexes
- [x] Settings schema renders and stores values; secret fields are encrypted

## Implementation (green, then refactor)

- `emdash-plugin.jsonc`, `src/storage/schema.ts`

## Acceptance criteria

- [x] Public route list matches the PRD's complete list
- [x] Admin banner when `EMDASH_ENCRYPTION_KEY` is missing, because secret settings can't be saved without it (S8, T005)
- [x] Route handlers return errors through `toRouteError` from `@semics-tech/shared` (T010); e-sign/payment codes confirmed or adjusted in the registry
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- Collection `auditEvents` is declared as `audit_events`: storage keys must match `^[a-z][a-z0-9_]*$`. CONTEXT.md updated.
- Unique indexes (`signers.tokenHash`, `clients.clientId`, `nonces.nonce`) are declared in the manifest; the sandbox test host does not create database unique constraints, so duplicate rejection is not testable there (tests assert the declarations instead).
- The test host's `inspect.setting` returns the raw encrypted envelope for secrets, so the tests assert at-rest encryption only, not decrypted read-back.
- Secrets: only `integrationMasterKey` and `turnstileSecretKey` are declared (client secrets derived, S8). A valid `EMDASH_ENCRYPTION_KEY` is `emdash_enc_v1_` + 43 base64url chars; `encryptionKeyStatus` (src/domain/encryption-key.ts) only checks presence, a malformed key surfaces as `PLUGIN_SETTING_ENCRYPTION_KEY_INVALID` from the host. The banner is a pure helper; wiring it into the Block Kit admin page belongs to the admin task.
- All 11 public routes are registered with stubs returning `NOT_FOUND` via `toRouteError`; real handlers land in later tasks. Registry codes (ENVELOPE_*, SIGNING_TOKEN_*, TEMPLATE_NOT_FOUND, TOKEN_REPLAYED, RATE_LIMITED, TURNSTILE_FAILED) already existed.
- Removed the scaffold `hello` route and its test. Added a `storage-host` vitest project using a fixture whose manifest symlinks the real one.
