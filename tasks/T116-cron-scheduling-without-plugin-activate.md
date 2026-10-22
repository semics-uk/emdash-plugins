---
id: T116
title: "Cron scheduling without plugin:activate"
phase: 2
package: repo
edition: free
status: review
model: opus-5.5
size: M
depends_on: [T056]
spec: [R23, R37]
---

# T116 · Cron scheduling without plugin:activate

## Definition

EmDash 1.2 does not run `plugin:activate` for sandboxed plugins declared under `sandboxed: [...]` in
`astro.config.mjs` (found in T056), so a config/npm install of either core never schedules its recurring
tasks: Events never sweeps holds (`sweep-holds`) or sends mail (`outbox-drain`), E-sign never drains its
outbox. Make both cores self-schedule regardless of how they were installed (R37), without breaking the
bridge budget, and report the upstream behaviour.

Investigate first (read `node_modules/emdash` and `@emdash-cms/cloudflare` sources): is there another
lifecycle hook that runs for config-declared sandboxed plugins (install, first request, `plugin:install`,
`cron` registration in the manifest)? Prefer a declarative mechanism if one exists. Otherwise ensure
schedules lazily: a cheap check (one KV `get` of a `cron:scheduled:v1` flag) on paths that always run on a
live site (public routes that the UI calls, admin page loads, content hooks), scheduling the recurring
tasks once and setting the flag; budget it into every affected route (≤ 10, target ≤ 8).

## Model

**Opus 5.5**: Platform behaviour, both packages, budget trade-offs.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] A host that never calls `plugin:activate` still ends up with `sweep-holds` and `outbox-drain` (Events) and the E-sign outbox drain scheduled after the first public route or admin load
- [x] Scheduling happens once (flag set; later calls make only the one check, or none)
- [x] Every affected route stays within budget (`expectWithinBudget`)
- [x] The playground's `/e2e/cron` no longer needs to activate the core itself

## Implementation (green, then refactor)

- `packages/events/src/plugin.ts`, `packages/esign/src/plugin.ts`, a small shared helper if useful

## Acceptance criteria

- [x] Upstream report drafted in `docs/upstream/emdash-sandboxed-activate.md` (repro, expected, actual) for the owner to file
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
corepack pnpm@10.23.0 verify
```

## Notes

- Investigation: EmDash 1.2 `EmDashRuntime.create` calls `installUnrecordedConfigPlugins(deps.plugins, …)` with native config plugins only; `sandboxedPluginEntries` are enabled but never get install/activate. There is no declarative cron field in the manifest schema and no other lifecycle hook for config sandboxed plugins, so the lazy check is used. Report: `docs/upstream/emdash-sandboxed-activate.md`.
- Mechanism (`packages/shared/src/schedules.ts`): `withScheduleCheck` wraps a route: one `kv.get cron:scheduled:v1`; when missing it queues a one-shot `ensure-schedules` task due now (+1 call) instead of scheduling inline, so a guarded route pays +1 steady and +2 until the first scheduler tick, however many recurring tasks there are. The task's cron tick schedules the recurring tasks and sets the flag (3 calls Events, 2 E-sign). `ctx.cron.schedule` is an upsert that resets `next_run_at`, which is why the flag is needed. Errors in the check are swallowed so a guarded route still answers.
- Guarded paths. Events: `public/events` (1 → 2, first 3), `public/event` (4 → 5, first 6), admin `page_load` only (≤ 8 incl. check, asserted by the existing admin budget test). E-sign: admin `page_load`, `templates/create`, `public/verify`. Tests prove checkout reserve/continue, `from-intent`, `submit`, `session`, `envelopes/send` and admin actions make no check. `public/session` was tried and dropped: it is 7 calls, so it reached 9 on first use.
- `plugin:activate` still schedules (same call count as before: 2 Events, 1 E-sign) but does not set the flag, so the existing activation budget tests stay untouched; after an activation the next guarded call queues `ensure-schedules` once, which re-upserts the same rows and sets the flag.
- Existing test changed: `packages/events/tests/public-events.test.ts` budget for `public/events` from 2 to 3 calls (first call includes the check and the ensure queueing).
- Runtime test hosts freeze the host clock at creation, so the new tests advance it (`scheduled.setTime(now + 1 s)`) before `scheduled.run()`; a real site's clock moves on its own.
- Playground `/e2e/cron` no longer calls `runPluginActivateLifecycle`; when the task row is missing it runs one scheduled batch (which runs a due `ensure-schedules`) and retries. New e2e test in `e2e/events.spec.ts` checks both rows appear after the first event page view and that the endpoint does not activate.
- Follow-up risk: the E-sign e2e harness reads clear-text tokens from outbox rows "before the one-minute drain scrubs them". Now that `outbox-drain` really is scheduled in the playground (from `templates/create`), a drain tick can race that read; the specs passed here, but if they flake, read the token from `/e2e/mail` instead.
- Flaky unrelated CPU warning seen once in `download.routes.test.ts` (large PDF, 73 ms on a busy machine); passed on rerun and in `pnpm verify`.
