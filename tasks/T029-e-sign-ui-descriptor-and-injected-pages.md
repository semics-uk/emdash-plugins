---
id: T029
title: "E-sign UI: descriptor and injected pages"
phase: 1
package: esign
edition: free
status: backlog
model: sonnet-5.5
size: S
depends_on: [T004, T006]
spec: [SU-FR-01, SU-FR-02]
---

# T029 · E-sign UI: descriptor and injected pages

## Definition

Add the `./ui`, `./astro`, `./client` and `./integration` entries to the e-sign package; the integration injects `/sign/[token]` and `/verify` pages with `Referrer-Policy: no-referrer`.

## Model

**Sonnet 5.5**: Follows the proven pattern.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Playwright: `/sign/<token>` renders the ceremony shell
- [ ] Response header assertion for the referrer policy
- [ ] Package exports resolve in the playground build

## Implementation (green, then refactor)

- Mirror the events package layout from T000

## Acceptance criteria

- [ ] Registry bundle still contains only the core
- [ ] The core's plugin ID is never hard-coded: it's a descriptor option (default the slug for npm installs) and the docs explain that registry installs use the `r_…` ID (S7, T005)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```
