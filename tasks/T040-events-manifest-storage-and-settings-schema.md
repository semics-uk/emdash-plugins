---
id: T040
title: "Events: manifest, storage and settings schema"
phase: 2
package: events
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T003, T010]
spec: [Events manifest, BUILD-PLAN §3.1]
---

# T040 · Events: manifest, storage and settings schema

## Definition

Declare the Free trust contract, every public route, storage collections with indexes (including `payments` keyed by id), and the settings schema.

## Model

**Sonnet 5.5**: Declarative.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Manifest validates
- [ ] Each collection accepts and queries by its indexes
- [ ] Allowed hosts are exactly `challenges.cloudflare.com`

## Implementation (green, then refactor)

- `emdash-plugin.jsonc`, `src/storage/schema.ts`

## Acceptance criteria

- [ ] Route list matches the PRD
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
