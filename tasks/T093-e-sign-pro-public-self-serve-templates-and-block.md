---
id: T093
title: "E-sign Pro: public self-serve templates and block"
phase: 6
package: esign
edition: pro
status: backlog
model: sonnet-5.5
size: M
depends_on: [T067]
spec: [ES-FR-18, SU-FR-12]
---

# T093 · E-sign Pro: public self-serve templates and block

## Definition

`public/self-serve/start` with Turnstile and the `esign-request` Portable Text block.

## Model

**Sonnet 5.5**: Composes existing parts.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Self-serve creates an envelope for the visitor
- [ ] Turnstile required
- [ ] Block renders on a page

## Implementation (green, then refactor)

- `src/routes/self-serve.ts`, UI block

## Acceptance criteria

- [ ] Within budget
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```
