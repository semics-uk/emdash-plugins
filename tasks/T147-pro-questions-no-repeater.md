---
id: T147
title: "Pro booking questions: add questions without a repeater, and show them on the Event editor"
phase: 7
package: events
edition: pro
status: backlog
model: sonnet-5.5
size: S
depends_on: [T141]
spec: []
---

# T147 · Pro questions without a repeater

## Definition

Found while doing T141. `packages/events-pro/src/questions/panel.ts` adds questions with
`repeater("newQuestions", …)` inside a form, which `@emdash-cms/blocks` draws as nothing, so "New
questions" is invisible in the admin. Also, Pro wraps only the `editor/tickets` route with the
questions form, so questions don't appear on Events → Event editor at all.

## Acceptance criteria

- [ ] Use the T141 render helper (`@semics-tech/shared/testing/blocks`) in a test that fails today: the
      questions form has no field Block Kit leaves undrawn.
- [ ] One blank "new question" row replaces the repeater; old `newQuestions` arrays still parse; the
      form re-keys after a successful save like the tickets form (`tickets.<rev>`).
- [ ] The Event editor page shows the questions form for an event, same as the entry panel.
