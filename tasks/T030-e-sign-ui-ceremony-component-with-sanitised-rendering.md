---
id: T030
title: "E-sign UI: ceremony component with sanitised rendering"
phase: 1
package: esign
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T029, T024]
spec: [SU-FR-03..08, SU-NFR-01..03]
---

# T030 · E-sign UI: ceremony component with sanitised rendering

## Definition

`<SigningCeremony>`: render the snapshot Markdown through an allowlist sanitiser, consent checkbox with the core's wording, fields, typed signature, completion screen; strict CSP.

## Model

**Opus 5.5**: Security-sensitive rendering of sender-supplied content.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] XSS payload suite (≥ 40 payloads) never executes or survives sanitising
- [ ] axe finds no serious violations
- [ ] Sign stays disabled until consent, intent and required fields are complete
- [ ] Works at 320 px wide

## Implementation (green, then refactor)

- `src/astro/SigningCeremony.astro`, `src/client/ceremony.ts`, sanitiser module

## Acceptance criteria

- [ ] CSP header allows only the package's hashed script
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```
