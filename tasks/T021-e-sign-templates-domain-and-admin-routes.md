---
id: T021
title: "E-sign: templates domain and admin routes"
phase: 1
package: esign
edition: free
status: backlog
model: sonnet-5.5
size: M
depends_on: [T020, T017, T014]
spec: [ES-FR-01, ES-US-1]
---

# T021 · E-sign: templates domain and admin routes

## Definition

Create, version, list and archive Markdown templates; editing makes a new version and never changes sent envelopes.

## Model

**Sonnet 5.5**: CRUD with versioning.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Create returns version 1; update returns version 2 and keeps version 1 readable
- [ ] Archived templates can't be used for new envelopes
- [ ] Private routes reject unauthenticated calls (runtime host)
- [ ] Each route within budget

## Implementation (green, then refactor)

- `src/domain/templates.ts`, `src/routes/templates.ts`

## Acceptance criteria

- [ ] Domain logic is pure and tested without the host
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
