---
id: T017
title: "Shared: template rendering and canonical snapshots"
phase: 1
package: shared
edition: free
status: in-progress
model: sonnet-5.5
size: S
depends_on: [T003]
spec: [ES-FR-01, ES-FR-03]
---

# T017 · Shared: template rendering and canonical snapshots

## Definition

Fill `{{field}}` placeholders in Markdown templates, escape values, and produce the canonical snapshot text whose SHA-256 is `docSha256`.

## Model

**Sonnet 5.5**: String processing with precise tests.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Placeholders fill, missing fields fail with a named error
- [ ] Values cannot inject Markdown or HTML
- [ ] Canonicalisation normalises line endings and Unicode (NFC) so equal documents hash equally

## Implementation (green, then refactor)

- `packages/shared/src/template.ts`

## Acceptance criteria

- [ ] Pure functions, 100% branch coverage
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```
