---
id: T060
title: "E-sign: integration clients and pairing strings"
phase: 3
package: esign
edition: free
status: review
model: sonnet-5.5
size: S
depends_on: [T034, T012]
spec: [ES-FR-12]
---

# T060 · E-sign: integration clients and pairing strings

## Definition

Admin Integrations page: create a client (pairing string shown once), list and revoke; secrets stored per Spike S8.

## Model

**Sonnet 5.5**: CRUD on top of proven primitives.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Pairing string shown once and never again
- [x] Revoked client is rejected
- [x] Secret storage matches the S8 decision

## Implementation (green, then refactor)

- `src/domain/clients.ts`, `src/admin/integrations.ts`

## Acceptance criteria

- [x] Within budget
- [x] Client secrets derived from the declared `integrationMasterKey` secret (S8 decision in BUILD-PLAN §7); pairing string shows the derived secret once
- [x] Define how the `integrationMasterKey` setting string becomes ≥ 32 raw bytes for `deriveClientSecret` (T012); Events caps intent `exp` at the hold expiry (R5)
- [x] Confirm or tighten `masterKeyBytes` (T022: UTF-8 of the trimmed setting, ≥ 32 bytes, fails closed); client doc fields `clientId`, `revokedAt`, `returnUrlAllowlist`
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- Master-key rule: `masterKeyBytes` is confirmed unchanged (UTF-8 of the trimmed setting, >= 32 bytes, fail closed). Tightened at the edges: the settings save refuses a typed key under 32 characters and saves it trimmed; `integrations.generate-key` sets 32 CSPRNG bytes as base64url (43 chars) and only runs while no key is set (a change re-pairs every client).
- Pairing string appears only in the `client.create` response (a code block with a copy-now warning); the client doc stores no secret (derived per S8). Revoke is `updateIf` on `revokedAt: null`.
- Return URLs: one per line, validated to protocol section 7 (max 10); blank means same-origin default.
- Bridge calls: page load 2, create/revoke/generate 3 (asserted at <= 8). CSRF: actions go through EmDash's admin API only.
- Coverage: admin and route code runs in workerd and is not counted; `domain/clients.ts` is covered by in-process tests.
- `lastUsedAt` is stored as null and never updated (from-intent does not write it; a write would cost a bridge call).
