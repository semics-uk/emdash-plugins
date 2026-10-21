---
id: T060
title: "E-sign: integration clients and pairing strings"
phase: 3
package: esign
edition: free
status: backlog
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

- [ ] Pairing string shown once and never again
- [ ] Revoked client is rejected
- [ ] Secret storage matches the S8 decision

## Implementation (green, then refactor)

- `src/domain/clients.ts`, `src/admin/integrations.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Client secrets derived from the declared `integrationMasterKey` secret (S8 decision in BUILD-PLAN §7); pairing string shows the derived secret once
- [ ] Define how the `integrationMasterKey` setting string becomes ≥ 32 raw bytes for `deriveClientSecret` (T012); Events caps intent `exp` at the hold expiry (R5)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
