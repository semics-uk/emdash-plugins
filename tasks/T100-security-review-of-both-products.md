---
id: T100
title: "Security review of both products"
phase: 7
package: repo
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T078, T087, T097]
spec: [Phase 7, Management plan: Security]
---

# T100 · Security review of both products

## Definition

Full review: public routes, token entropy, rate limits, CSRF assumptions, XSS, licence code, dependency audit; fixes land with tests.

## Model

**Opus 5.5**: Security judgement.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Every finding has a regression test
- [x] `pnpm audit` clean or justified

## Implementation (green, then refactor)

- `tasks/reviews/security-1.0.md`

## Acceptance criteria

- [x] No open Severity 1 or 2
- [x] Sandboxed routes that throw reach public callers as `400 ROUTE_ERROR` carrying the raw `Error.message` (EmDash dispatch); today the messages are fixed strings (`audit chain contention`, `download link key unavailable`), so check none can carry stored data or a token, or catch and map them to `INTERNAL` (T034 review, Severity 3)
- [x] `public/envelopes/from-intent` has no rate limit: malformed tokens are rejected before any bridge call, an unknown `cid` costs 2 calls (settings + client). Decide whether a per-IP failure counter is worth a call (T034 review, Severity 4)
- [x] Events reserve salts `ipHash` with a secret even when no Turnstile secret is set (today the plugin id), without taking reserve past 10 bridge calls (T057 review F6)
- [x] `checkout/continue` verifies an unknown ref against a decoy hash like `public/booking` and `/redeem` (T057 review F10)
- [x] Confirm or revisit "no per-IP limit on wrong tokens and codes" for booking, cancel, redeem and continue, and the idempotency-key resubmit that re-issues a token (T057 review F11, F16)
- [x] Outbox `lastError` cannot keep a booking link or token from provider error text (scrub or keep only a code) (T057 review F12)
- [x] CSV formula defence also covers full-width `＝ ＋ － ＠` (T057 review F13)
- [x] Confirm the T117 exception: the E-sign core imports the pure, import-free `src/astro/lib/markdown.ts` for the signed PDF; it must stay dependency-free (add a test that it imports nothing)
- [x] E-sign Pro `public/self-serve/start` runs at exactly 10 bridge calls (T093): get it to ≤ 9 so an error-path log can never be the 11th; clean up `ss:cap:<template>:<day>` KV counters
- [x] Shared `rateLimit` KV keys (`rl:<scope>:<hash>:<window>`) are never deleted (KV has no TTL; T081): sweep expired windows in both cores' retention jobs
- [x] Review the Pro PDF reader's refusal of active content and encrypted files (R53) against malformed and hostile PDFs, including fuzzed xref and object-stream input (follow-up from T094)
- [x] Review Events Pro MCP routes (R59): the per-call token hash minted so Free booking routes run as admin is never stored, logged or returned, and every pro/mcp route refuses non-admins (follow-up from T086)
- [x] Bring Events Pro MCP cancel and refund on a paid booking (asserted ≤10 bridge calls) down to the 8-call target, or record a §12 exception with the measured count (R22, follow-up from T086)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```

## Notes

- Report: `tasks/reviews/security.md` (the task named `security-1.0.md`; the orchestrator's brief asked for
  `security.md`, which is what exists). 20 findings: 0 Sev 1, 1 Sev 2 (fixed), 7 Sev 3 (6 fixed, 1 accepted with a
  test), 12 Sev 4 (4 fixed, 8 accepted or confirmed with tests). Decisions R60-R63.
- Every filed criterion is answered: ROUTE_ERROR messages (fixed strings, static test), from-intent (accepted,
  tested), IP salt (random undeclared `ipSalt` setting), continue decoy, wrong-token limits and idempotency resubmit
  (accepted, R62), outbox `lastError` scrub, full-width CSV, markdown imports nothing (static test), self-serve 9
  calls and its caps under `rl:`, `rl:` sweep in both retention passes, PDF reader fuzz (deflate bomb fixed), MCP
  token (confirmed) and MCP budgets (R60 exception, measured 10 and 9).
- New findings beyond the filed ones: Pro stored exports never deleted (Sev 2), OTP attempts race (Sev 3), licence
  Worker re-issuing a refunded licence (Sev 3).
- Shared change for both editions: `rateLimit` values are now `<count>:<window end>` (old keys are read as counts
  and swept on the first pass, a one-time reset of live windows); `verifyToken` accepts a missing hash.
- The scaffold `hello` route (T106 checklist, T057 F14) is removed here: its bytes paid for the Events fixes.
  T106 can tick that item.
- Pro commits are on branch `pro-agent-t100` in `/Users/semics/code/semics/.pro-worktrees/agent-t100`; the Pro
  tests need the Free changes here (shared `sweepRateLimits`, `verifyToken`), so land Free first.
- `pnpm audit`: every advisory is dev-only (playground's miniflare, vitest) or inside the EmDash host; justified in
  the report, no owner action required.
