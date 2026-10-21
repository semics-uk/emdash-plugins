---
id: T020
title: "E-sign: manifest, storage and settings schema"
phase: 1
package: esign
edition: free
status: in-progress
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

- [ ] Manifest validates
- [ ] Runtime host: each declared collection accepts a document and queries by its indexes
- [ ] Settings schema renders and stores values; secret fields are encrypted

## Implementation (green, then refactor)

- `emdash-plugin.jsonc`, `src/storage/schema.ts`

## Acceptance criteria

- [ ] Public route list matches the PRD's complete list
- [ ] Admin banner when `EMDASH_ENCRYPTION_KEY` is missing, because secret settings can't be saved without it (S8, T005)
- [ ] Route handlers return errors through `toRouteError` from `@semics-tech/shared` (T010); e-sign/payment codes confirmed or adjusted in the registry
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
