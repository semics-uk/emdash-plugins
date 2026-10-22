---
id: T096
title: "E-sign Pro: MCP tools"
phase: 6
package: esign
edition: pro
status: in-progress
model: sonnet-5.5
size: S
depends_on: [T067, T071]
spec: [ES-FR-21]
---

# T096 · E-sign Pro: MCP tools

## Definition

List templates, send for signature, envelope status, remind, void (destructive).

## Model

**Sonnet 5.5**: Thin wrappers.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Tools register with permissions
- [ ] Void flagged destructive

## Implementation (green, then refactor)

- `src/mcp/*.ts`

## Acceptance criteria

- [ ] Reuse route handlers
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
```
