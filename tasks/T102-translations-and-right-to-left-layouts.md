---
id: T102
title: "Translations and right-to-left layouts"
phase: 7
package: repo
edition: free
status: in-progress
model: sonnet-5.5
size: S
depends_on: [T078, T093]
spec: [EU-NFR-04, SU-NFR-06]
---

# T102 · Translations and right-to-left layouts

## Definition

Extract strings, ship `en` and one RTL language, verify layouts.

## Model

**Sonnet 5.5**: Mechanical extraction.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Snapshot tests in `en` and `ar`
- [ ] No hard-coded strings (lint)

## Implementation (green, then refactor)

- `src/i18n/`

## Acceptance criteria

- [ ] Docs on adding a language
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```
