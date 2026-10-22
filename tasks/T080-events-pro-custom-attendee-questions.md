---
id: T080
title: "Events Pro: custom attendee questions"
phase: 5
package: events
edition: pro
status: review
model: sonnet-5.5
size: M
depends_on: [T057, T071]
spec: [EV-FR-15, EU-FR-10]
---

# T080 · Events Pro: custom attendee questions

## Definition

Question repeater in the panel (text, choice, checkbox, required), validation in checkout, answers in CSV.

## Model

**Sonnet 5.5**: Form schema work.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Required answers enforced
- [x] CSV includes answers
- [x] Widget renders each question type accessibly

## Implementation (green, then refactor)

- `src/domain/questions.ts`, widget fields

## Acceptance criteria

- [x] Within budget
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```

## Notes

- Decision R52 (BUILD-PLAN §12): the buyer answers each question once per booking (the widget collects only the
  buyer); answers go on `booking.answers` and every attendee row of the CSV repeats them. `config.questions[]` and
  `booking.answers` were already in the Free schema; the Free backend is unchanged (115.9 KiB, R51).
- Pro (branch `pro-agent-t080`, `packages/events-pro`): `src/domain/questions.ts` (pure rules),
  `src/questions/panel.ts` (wraps `editor/tickets`: "Attendee questions" form, `questions.save`, licence-checked,
  `updateIf` setting only `questions`, 7 calls), `src/questions/routes.ts` (wraps `public/event`, 0 calls, and
  `public/checkout/reserve`: `answers` checked at Free's draft write, refusal `BAD_REQUEST` with `answers.<id>` issues
  before any seat is held, 0 extra calls), `src/questions/export.ts` (replaces `attendees/export`, 3 calls; the
  reports export snapshots the questions when it starts, +1 call on its first step). Pro backend 192.9 KiB (≤ 256).
- Public: `src/astro/lib/questions.ts`, widget fieldset "About you", `answers` sent only with the `questions` marker
  (Free's reserve refuses unknown keys), `q:<id>` widget fields, client-side `missingAnswers`. e2e
  `apps/playground/e2e/t080-questions.spec.ts` on `/e2e/questions` (the playground runs Free, so the page passes the
  event as Pro answers it).
- Not done (out of scope): per-attendee answers, answers on the booking page or in emails, answers on waitlist
  offer bookings (made by cron, they carry none).
- Port 4401 on this machine was held by an unrelated site, so the playground e2e ran with a temporary config on port
  4481 (90 passed; config removed afterwards).
- Landing: the Pro worktree's `node_modules/@semics-tech/{emdash-events,shared}` links were pointed at this public
  worktree for testing and are put back; run `pnpm install` in the Pro repo after landing.
