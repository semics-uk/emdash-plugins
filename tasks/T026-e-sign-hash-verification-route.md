---
id: T026
title: "E-sign: hash verification route"
phase: 1
package: esign
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T025]
spec: [ES-FR-09, ES-US-6]
---

# T026 · E-sign: hash verification route

## Definition

`public/verify` takes `{ sha256 }` and reports whether it matches a completed envelope's `pdfSha256`, with no personal data.

## Model

**Sonnet 5.5**: Small route.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Known hash returns matched with date and status
- [ ] Unknown hash returns not matched
- [ ] Response has no names or emails
- [ ] Rate-limited

## Implementation (green, then refactor)

- `src/routes/verify.ts`

## Acceptance criteria

- [ ] Within budget
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
