---
id: T136
title: "Events: restore Free bundle headroom (at least 4 KiB under the 125 KiB budget)"
phase: 7
package: events
edition: free
status: in-progress
model: opus-5.5
size: M
depends_on: []
spec: [R51, R94]
---

# T136 · Events: Free bundle headroom

## Definition

After T129-T132 the Free Events backend is ~131 B under its 125 KiB budget (R94), 3 KiB under the
registry's 128 KiB cap, so no hotfix fits. Make at least 4 KiB of room under 125 KiB without removing a
feature: e.g. move admin-only Block Kit builders or texts that can be data, share code paths duplicated
across routes (reserve/continue/waitlist), shorten internal keys, check what the bundler pulls in from
`packages/shared` (tree-shaking, side-effect flags), compare minifier settings. Measure each change; keep
public behaviour and stored data unchanged. Record the result (R number) and the headroom in CONTEXT.md.

## Acceptance criteria

- [ ] Backend ≥ 4 KiB under the 125 KiB budget, measured by the bundle-size test
- [ ] All Events tests and the Pro Events suite unchanged and green (Pro builds on the Free core)
- [ ] Decision recorded; CONTEXT.md; changeset (patch)
- [ ] Meets the Definition of Done
