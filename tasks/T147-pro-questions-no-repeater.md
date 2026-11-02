---
id: T147
title: "Pro booking questions: add questions without a repeater, and show them on the Event editor"
phase: 7
package: events
edition: pro
status: review
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

- [x] Use the T141 render helper (`@semics-tech/shared/testing/blocks`) in a test that fails today: the
      questions form has no field Block Kit leaves undrawn.
- [x] One blank "new question" row replaces the repeater; old `newQuestions` arrays still parse; the
      form re-keys after a successful save like the tickets form (`tickets.<rev>`).
- [x] The Event editor page shows the questions form for an event, same as the entry panel.

## Notes

- All code is in the Pro repo, branch `pro-agent-a5fbcb7331d34b560` (worktree `/Users/semics/code/semics/.pro-worktrees/agent-a5fbcb7331d34b560`). No public (MIT) change: the Event editor page needed no Free seam, because Free's `admin` route sends only `panel.*` actions to the panel, and Pro wraps the `admin` route (`eventPageWithQuestions`, innermost, around `adminRoute({ waivers })`).
- The T141 renderer helper cannot run in the `editions` (workerd) project, so the "no undrawn field" test is `tests/questions.render.unit.test.ts` (node) against the exported `questionsBlocks`; the editions tests assert no `repeater` in the panel and page JSON.
- Form key: `questions` before any save, `questions.<rev>` after a save (a refused save keeps the key so typing stays). On the page the block id is `event:<id>:<n>:questions[.<rev>]`.
- The Event editor page costs one extra config read on a load; a questions save there re-shows the page through Free's `events.edit`.
