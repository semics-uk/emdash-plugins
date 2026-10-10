---
id: T024
title: "E-sign: signing ceremony public routes"
phase: 1
package: esign
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T023, T013]
spec: [ES-FR-04, ES-US-2]
---

# T024 · E-sign: signing ceremony public routes

## Definition

`public/session` and `public/submit`: consent, intent, typed name or stroke JSON, field validation, binding the signature to `docSha256`, and completing the envelope.

## Model

**Opus 5.5**: Internet-facing route with legal-evidence requirements.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Submit without consent or intent fails
- [ ] Stroke JSON over 32 KB is rejected
- [ ] Wrong or reused token fails
- [ ] A completed submit writes audit events and moves status to completed
- [ ] Both routes within budget
- [ ] Responses contain no other signer's data

## Implementation (green, then refactor)

- `src/routes/ceremony.ts`, `src/domain/signing.ts`

## Acceptance criteria

- [ ] Public routes declare methods and body limits
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
