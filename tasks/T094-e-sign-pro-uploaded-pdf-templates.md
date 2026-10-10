---
id: T094
title: "E-sign Pro: uploaded PDF templates"
phase: 6
package: esign
edition: pro
status: backlog
model: opus-5.5
size: L
depends_on: [T067, T110]
spec: [ES-FR-19, Spike S5]
---

# T094 · E-sign Pro: uploaded PDF templates

## Definition

Read uploaded PDFs (`media:bytes:read`), stamp fields at entered coordinates, store the result and its hash; stamping runs in the sandbox or the UI layer per Spike S5.

## Model

**Opus 5.5**: PDF manipulation under CPU limits.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Stamped output opens and shows fields at the right coordinates
- [ ] Hash recorded by the core
- [ ] Over-limit PDFs rejected with a code

## Implementation (green, then refactor)

- `src/domain/pdf-templates.ts`

## Acceptance criteria

- [ ] Decision recorded
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```
