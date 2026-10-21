---
id: T021
title: "E-sign: templates domain and admin routes"
phase: 1
package: esign
edition: free
status: done
model: sonnet-5.5
size: M
depends_on: [T020, T017, T014]
spec: [ES-FR-01, ES-US-1]
---

# T021 · E-sign: templates domain and admin routes

## Definition

Create, version, list and archive Markdown templates; editing makes a new version and never changes sent envelopes.

## Model

**Sonnet 5.5**: CRUD with versioning.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Create returns version 1; update returns version 2 and keeps version 1 readable
- [x] Archived templates can't be used for new envelopes
- [x] Private routes reject unauthenticated calls (runtime host)
- [x] Each route within budget

## Implementation (green, then refactor)

- `src/domain/templates.ts`, `src/routes/templates.ts`

## Acceptance criteria

- [x] Domain logic is pure and tested without the host
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```

## Notes

- One head document per template (id = template id, status `active`/`archived`) plus immutable version documents
  (`<id>:v<n>`, status `version`); `list` filters on status. Bridge calls: create 1, update 2, get 1, list 1, archive 2.
- T022: load the head and call `usableForNewEnvelope`; archived → `TEMPLATE_NOT_FOUND`; editing archived → `TEMPLATE_ARCHIVED` issue.
- Out of scope: un-archive route, `list` cursor (200 cap).
- Red evidence for the auth test is weak (route didn't exist); green proves 401/403 on all five routes.
