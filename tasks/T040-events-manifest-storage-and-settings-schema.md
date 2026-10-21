---
id: T040
title: "Events: manifest, storage and settings schema"
phase: 2
package: events
edition: free
status: review
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

- [x] Manifest validates
- [x] Each collection accepts and queries by its indexes
- [x] Allowed hosts are exactly `challenges.cloudflare.com`

## Implementation (green, then refactor)

- `emdash-plugin.jsonc`, `src/storage/schema.ts`

## Acceptance criteria

- [x] Route list matches the PRD
- [x] Admin banner when `EMDASH_ENCRYPTION_KEY` is missing, because secret settings can't be saved without it (S8, T005)
- [x] Route handlers return errors through `toRouteError` from `@semics-tech/shared` (T010); e-sign/payment codes confirmed or adjusted in the registry
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- The in-memory plugin test host (@emdash-cms/plugin-test 0.2.8) does not enforce unique indexes (it merges `uniqueIndexes` into plain indexes). The red commit's "rejects a duplicate" tests could not pass there, so they now assert the manifest declares the unique fields; real enforcement must be proven on D1 (load tests, T110).
- Capability `network:request` makes `ctx.http` optional in types; the contract-probe fixture uses `ctx.http!`.
- Public routes are stubs returning `toRouteError("NOT_FOUND")` until their tasks land. Route names listed in `src/routes/public.ts`.
- Vitest `hookTimeout` raised to 120s because the contract host start exceeded 10s on a loaded machine. Manifest test runs in its own node project.
- Collection names are snake_case (manifest schema pattern). The playground e2e was not run; no workerd started.
