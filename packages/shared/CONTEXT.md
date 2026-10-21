# Shared package context

`@semics-tech/shared` is private, source-only TypeScript (`exports: { ".": "./src/index.ts" }`, no build).
The cores list it in **devDependencies** so `emdash-plugin build` inlines it into the sandbox bundle; a
runtime dependency would ship an unresolvable import.

- Web APIs only, no Node built-ins, pure functions, injected time and randomness.
- Coverage: 90% lines on all of `src/` (`coverageConfig({ allSource: true })`); 100% branches for
  security modules (tokens, HMAC, licence, audit helpers).
- Never imports a core or UI.
- `testing/` holds test-only helpers (budget harness, T007); runtime code must never import it.

Modules so far: `result.ts` (Result type, `ERROR_CODES`, `toRouteError`), `money.ts`, `time.ts`, `ics.ts`
(T018), `tokens.ts` (T011: `generateToken`, `hashToken`, `verifyToken`, `constantTimeEqual`, `signLink`/
`verifyLink` — reuse `constantTimeEqual` in hmac), `pdf/` (T016: `renderPdf(doc)` → deterministic PDF bytes from
blocks — heading, paragraph, table, signature (stroke JSON as vector paths), rule, spacer, pageBreak — plus
`measureText`/`wrapText`; Helvetica WinAnsi only, never embeds fonts or images; inject `info.creationDate`;
tests check output with `tests/helpers/pdf-parse.ts`). Security globs at 100% branches are listed in
`vitest.config.ts` `strictBranches`. Planned: hmac + pairing
(implement `docs/protocol/esign-intent-v1.md` exactly), ratelimit, turnstile, blockkit, outbox,
template, rrule, licence.
