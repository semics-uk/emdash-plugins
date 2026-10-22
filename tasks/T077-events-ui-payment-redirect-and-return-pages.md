---
id: T077
title: "Events UI: payment redirect and return pages"
phase: 4
package: events
edition: pro
status: backlog
model: sonnet-5.5
size: S
depends_on: [T073, T055, T071]
spec: [EU-FR-09]
---

# T077 · Events UI: payment redirect and return pages

## Definition

Widget redirects to Stripe when `next` is `pay`; return page shows success, pending or failed.

## Model

**Sonnet 5.5**: UI wiring.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] Playwright with a faked Stripe redirect shows each outcome

## Implementation (green, then refactor)

- `src/astro/PaymentReturn.astro`

## Acceptance criteria

- [ ] Accessible
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```
