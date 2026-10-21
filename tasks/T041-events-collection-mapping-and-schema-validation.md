---
id: T041
title: "Events: collection mapping and schema validation"
phase: 2
package: events
edition: free
status: done
model: sonnet-5.5
size: S
depends_on: [T040]
spec: [EV-FR-01, EV-US-1]
---

# T041 · Events: collection mapping and schema validation

## Definition

Settings map the events collection and its fields; `schema:read` validation produces an admin banner when broken.

## Model

**Sonnet 5.5**: Validation logic.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Valid mapping passes
- [x] Missing field produces a named banner message
- [x] Mapping to a non-existent collection fails

## Implementation (green, then refactor)

- `src/domain/mapping.ts`

## Acceptance criteria

- [x] Banner text tested
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```

## Notes

- `validateMapping(mapping, schemas)` in `src/domain/mapping.ts` is pure. The caller (admin page or settings-save route, later tasks) reads collections via `schema:read` and passes `{ slug: { fields } }`; no `schema:read` call is wired yet.
- Start and timezone fields are required; end and venue may be blank. Banner texts are asserted verbatim in `tests/domain/mapping.test.ts`.
- Branch was fast-forwarded to main to pick up T040. Playground e2e not run; no workerd started.
