---
id: T067
title: "Phase 3 gate: integration security and E2E"
phase: 3
package: suite
edition: free
status: done
model: opus-5.5
size: S
depends_on: [T066]
spec: [Phase 3 exit, SX-NFR-*]
---

# T067 · Phase 3 gate: integration security and E2E

## Definition

Run every protocol vector against both deployed cores, forgery and replay attacks, open-redirect tests; review recorded.

## Model

**Opus 5.5**: Security judgement.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Waiver-required booking can't confirm without receipts
- [x] All attack tests fail safely

## Implementation (green, then refactor)

- `apps/playground/e2e/waiver.spec.ts`, `tasks/reviews/phase-3.md`

## Acceptance criteria

- [x] No open Severity 1 or 2
- [x] Declined/expired receipts are re-forwarded on every status-page load while the booking waits (T066): stop asking once a ref has a terminal receipt recorded
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
pnpm verify
```

## Notes

- **Review:** `tasks/reviews/phase-3.md`. Severity 1: none. Severity 2: three, all fixed test-first: F1 a Pro
  site switched to Free could not read its settings, so Free stopped selling (the Free manifests now declare
  the Pro secrets, BUILD-PLAN R44); F2 e-sign's idempotent return gave a signing token to any intent for the
  ref and none to the door link of an emailed adult; F3 "Try again" never received the access token
  (`Path=/booking`). Severity 3–4 are filed on the new T119 or accepted. The acceptance criterion on
  re-forwarded terminal receipts is F4 (fixed).
- **E2E with Pro.** The playground can't load Pro, so the end-to-end proof is in the Pro repo:
  `events-pro/tests/integration.editions.test.ts` runs Events Pro and the Free e-sign bundle side by side in
  workerd (new `startSideCore` in pro-kit), every call asserted ≤ 10 bridge calls. The review lists what it
  does and doesn't cover. `apps/playground/e2e/waiver.spec.ts` (Free cores) covers the pages: 403 for
  cross-site posts, the door page, the retry. It and the T065 spec ran green (7/7) on port 4417 with a
  temporary config that was not committed, because port 4401 was held by another project's Docker preview
  that had to stay up. `pnpm --filter playground e2e` itself still uses 4401.
- **Land order:** the Pro branch `pro-agent-t067` needs this public branch landed first (the Free manifests
  declare the Pro secrets, or `settingsText` fails in generate; the door E2E needs the e-sign fix). Locally
  the Pro worktree's `node_modules` links for `emdash-events` and `emdash-esign` were pointed at this worktree.
  That change was not committed.
- Deliberate manifest change: three secret settings in Events and one in E-sign, all labelled "(Pro)". The
  changeset is `phase-3-review.md`.
