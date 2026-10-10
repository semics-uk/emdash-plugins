---
id: T086
title: "Events Pro: MCP tools"
phase: 5
package: events
edition: pro
status: backlog
model: sonnet-5.5
size: S
depends_on: [T057]
spec: [EV-FR-18]
---

# T086 · Events Pro: MCP tools

## Definition

List events, availability, find booking, list attendees, check in, cancel and refund (destructive marked), with zod schemas and permissions.

## Model

**Sonnet 5.5**: Thin wrappers over routes.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Each tool registers with its permission
- [ ] Destructive tools flagged
- [ ] Runtime host consent/permission tests pass

## Implementation (green, then refactor)

- `src/mcp/*.ts`

## Acceptance criteria

- [ ] Reuse route handlers
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
```
