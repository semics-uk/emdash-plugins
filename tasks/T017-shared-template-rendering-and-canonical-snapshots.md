---
id: T017
title: "Shared: template rendering and canonical snapshots"
phase: 1
package: shared
edition: free
status: review
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

- [x] Placeholders fill, missing fields fail with a named error
- [x] Values cannot inject Markdown or HTML
- [x] Canonicalisation normalises line endings and Unicode (NFC) so equal documents hash equally

## Implementation (green, then refactor)

- `packages/shared/src/template.ts`

## Acceptance criteria

- [x] Pure functions, 100% branch coverage
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/shared verify
```

## Notes

- Canonical form (documented in packages/shared/src/template.ts): strip BOM, CRLF/CR to LF, NFC, strip trailing spaces/tabs per line, exactly one trailing newline. docSha256 = sha256Hex(canonicalSnapshot(rendered)).
- Escaping: values flattened to one line, HTML-escaped and Markdown backslash-escaped at render time; values are never re-expanded.
- Missing field throws TemplateError (code TEMPLATE_MISSING_FIELD, .field).
