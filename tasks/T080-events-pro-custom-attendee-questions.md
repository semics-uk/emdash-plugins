---
id: T080
title: "Events Pro: custom attendee questions"
phase: 5
package: events
edition: pro
status: backlog
model: sonnet-5.5
size: M
depends_on: [T057]
spec: [EV-FR-15, EU-FR-10]
---

# T080 · Events Pro: custom attendee questions

## Definition

Question repeater in the panel (text, choice, checkbox, required), validation in checkout, answers in CSV.

## Model

**Sonnet 5.5**: Form schema work.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Required answers enforced
- [ ] CSV includes answers
- [ ] Widget renders each question type accessibly

## Implementation (green, then refactor)

- `src/domain/questions.ts`, widget fields

## Acceptance criteria

- [ ] Within budget
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```
