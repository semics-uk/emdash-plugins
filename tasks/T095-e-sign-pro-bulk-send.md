---
id: T095
title: "E-sign Pro: bulk send"
phase: 6
package: esign
edition: pro
status: backlog
model: sonnet-5.5
size: S
depends_on: [T090, T071]
spec: [ES-FR-20]
---

# T095 · E-sign Pro: bulk send

## Definition

Send one template to a CSV of recipients in cron batches.

## Model

**Sonnet 5.5**: Batch job.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] CSV validation reports bad rows
- [ ] Batches stay within budget
- [ ] Each recipient gets their own envelope

## Implementation (green, then refactor)

- `src/domain/bulk.ts`

## Acceptance criteria

- [ ] Progress shown in admin
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
