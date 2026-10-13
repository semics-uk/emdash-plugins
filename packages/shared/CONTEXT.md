# Shared package context

`@semics-tech/shared` is private, source-only TypeScript (`exports: { ".": "./src/index.ts" }`, no build).
The cores list it in **devDependencies** so `emdash-plugin build` inlines it into the sandbox bundle; a
runtime dependency would ship an unresolvable import.

- Web APIs only, no Node built-ins, pure functions, injected time and randomness.
- Coverage: 90% lines on all of `src/` (`coverageConfig({ allSource: true })`); 100% branches for
  security modules (tokens, HMAC, licence, audit helpers).
- Never imports a core or UI.
- `testing/` holds test-only helpers (budget harness, T007); runtime code must never import it.

Modules so far: `result.ts` (Result type, `ERROR_CODES`, `toRouteError`). Planned: tokens, hmac + pairing
(implement `docs/protocol/esign-intent-v1.md` exactly), ratelimit, turnstile, blockkit, outbox, pdf,
template, money, time, ics, rrule, licence.
