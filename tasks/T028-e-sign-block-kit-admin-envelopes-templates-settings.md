---
id: T028
title: "E-sign: Block Kit admin (envelopes, templates, settings)"
phase: 1
package: esign
edition: free
status: backlog
model: sonnet-5.5
size: M
depends_on: [T021, T022, T014]
spec: [ES-FR-11, ES-US-4]
---

# T028 · E-sign: Block Kit admin (envelopes, templates, settings)

## Definition

Envelopes table with status filter and detail with audit timeline; template editor with preview; settings page.

## Model

**Sonnet 5.5**: UI composition with builders.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Runtime host admin helpers load each page and validate Block Kit
- [ ] Form submit creates a template
- [ ] Envelope detail shows audit events in order

## Implementation (green, then refactor)

- `src/admin/*.ts`, `admin` route

## Acceptance criteria

- [ ] Pages declared in manifest
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
