---
id: T027
title: "E-sign: invitation and completion emails"
phase: 1
package: esign
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T024, T015]
spec: [ES-FR-10]
---

# T027 · E-sign: invitation and completion emails

## Definition

Queue invitation and completion emails with links only, through the outbox.

## Model

**Sonnet 5.5**: Templates and wiring.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Send queues one invitation per signer
- [ ] Completion queues the download email
- [ ] No transport: admin banner state is reported

## Implementation (green, then refactor)

- `src/emails/*.ts` templates (text + simple HTML)

## Acceptance criteria

- [ ] Templates snapshot-tested
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
