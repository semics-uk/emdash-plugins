# Shared package context

`@semics-tech/shared` is private, source-only TypeScript (`exports: { ".": "./src/index.ts" }`, no build).
The cores list it in **devDependencies** so `emdash-plugin build` inlines it into the sandbox bundle; a
runtime dependency would ship an unresolvable import.

- Web APIs only, no Node built-ins, pure functions, injected time and randomness.
- Coverage: 90% lines on all of `src/` (`coverageConfig({ allSource: true })`); 100% branches for
  security modules (tokens, HMAC, licence, audit helpers).
- Never imports a core or UI.
- `testing/` holds test-only helpers (budget harness, T007); runtime code must never import it.

Modules so far: `result.ts` (Result, `ERROR_CODES`, `toRouteError`), `money.ts`, `time.ts`, `ics.ts` (T018),
`tokens.ts` (T011: opaque tokens, `constantTimeEqual`, `signLink`/`verifyLink`), `hmac.ts` + `pairing.ts`
(T012: `esign-intent/1` sign/verify per type, injected `consumeNonce`, `isReturnUrlAllowed`,
`deriveClientSecret`), `blockkit.ts` (T014: typed builders, `notice`/`notices` banners), `template.ts` (T017:
`renderTemplate`, `canonicalSnapshot`, `sha256Hex`), `pdf/` (T016: `renderPdf`, deterministic), `ratelimit.ts`
(T013: `rateLimit(store, ip, now, opts)`, hashed IPs, 2 store calls) and `turnstile.ts` (T013: `verifyTurnstile`). Security
globs at 100% branches: `strictBranches` in `vitest.config.ts`. `outbox.ts` (T015: `enqueueEmail`, `drainOutbox` with per-tick cap, `outboxStatus`, `OUTBOX_COLLECTION`). `licence.ts` (T070: `semics1.` Ed25519 keys, `createLicenceVerifier(build)` with the
public key, product and build date injected at build time, exempt local/preview hosts, `signLicence` for
issuing) and `gate.ts` (T070: `gateProWork`/`gateProOperation`: no new Pro work without a key, in-flight
work continues). `schedules.ts` (T116: `withScheduleCheck`, `ensureSchedules`, `runEnsureSchedulesJob`,
`scheduleTasks`: cores self-schedule recurring crons behind a `cron:scheduled:v1` KV flag). Planned: rrule.
