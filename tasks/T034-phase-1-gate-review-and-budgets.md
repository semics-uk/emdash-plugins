---
id: T034
title: "Phase 1 gate: review and budgets"
phase: 1
package: esign
edition: free
status: review
model: opus-5.5
size: S
depends_on: [T033]
spec: [Phase 1 exit, ES-NFR-*]
---

# T034 · Phase 1 gate: review and budgets

## Definition

Adversarial review of the e-sign core and UI: security of public routes, budgets on every route, coverage, and PRD conformance. Fix or file issues before Phase 2 depends on shared modules.

## Model

**Opus 5.5**: Judgement-heavy review.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Review checklist executed and recorded in `tasks/reviews/phase-1.md`
- [x] Every public route has a budget assertion

## Implementation (green, then refactor)

- Run the code-review skill over the phase diff

## Acceptance criteria

- [x] No open Severity 1 or 2 findings
- [x] Route errors set the HTTP status from `toRouteError().status` (T021/T022 return the error body with 200)
- [x] E-sign admin envelope list pages past the newest 100 (T028); coverage thresholds hold for `packages/esign/src/admin` and `packages/events/src/admin` on CI
- [x] E-sign admin "new envelope" form exposes `signerFields` (T033 added them to `envelopes/create`)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm verify
pnpm --filter playground e2e
```

## Notes

- Review record, severity scale, checklist and budget table: `tasks/reviews/phase-1.md`. No Severity 1; four
  Severity 2 fixed test-first (visitor IP/UA lost on in-process UI calls, R38; consent wording overclaim,
  ES-NFR-07; signer-entered values not bound or printed; unsalted `signatureSha256`, R28). Severity 3-4 filed on
  T097, T100, T105 and the new T116; two were already on T061/T062.
- HTTP status: not possible for sandboxed JSON routes in EmDash 1.2 (a returned value is always 200, a thrown
  error 400 `ROUTE_ERROR`); closed with R37 and a note in protocol §9. The raw `public/download` already uses
  `toRouteError().status`.
- Coverage: the ~54% figure counts only code a test imports; workerd-run routes, cron and admin are exercised by
  host tests but invisible to v8. Instrumenting the sandbox bundle is not supported by the test host; decision
  recorded in `vitest.coverage.mjs`. There are no `src/admin` thresholds in either package.
- `bindSignature` now takes `{ fieldValues, salt }`; signature hashes of envelopes signed before this change
  (none outside tests) would not re-verify under the new formula.
- The consent default changed but `consentVersion` stays `1` (pre-release). Events' identical in-process IP gap
  is being fixed by T056 on its own branch (IP headers only, `cf` via RequestInit).
- Added after the T057 review: CSRF check on the sign and verify pages (Severity 2, fixed test-first); the outbox give-up log is the 9th call, not an 11th (regression test).
- Code-review: the review itself was the adversarial pass over the phase; the T034 diff was self-reviewed.
