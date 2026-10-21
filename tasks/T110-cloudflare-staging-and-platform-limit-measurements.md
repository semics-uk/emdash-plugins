---
id: T110
title: "Cloudflare staging and platform-limit measurements"
phase: 0
package: repo
edition: free
status: review
model: opus-5.5
size: M
depends_on: [T009]
spec: [Spikes S1, S5, EV-NFR-01, EV-NFR-02]
---

# T110 · Cloudflare staging and platform-limit measurements

## Definition

Deploy the playground to Cloudflare staging with Worker Loader, measure bridge calls against the 10-subrequest limit and PDF CPU against 50 ms, and add a nightly staging run. Blocked until the owner creates the Workers Paid account.

## Model

**Opus 5.5**: Platform measurement that confirms or overturns design assumptions.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Probe route records the subrequest failure point
- [x] PDF benchmark recorded for 1, 3 and 5 pages
- [ ] Nightly job green

## Implementation (green, then refactor)

- `apps/playground/wrangler.jsonc`, `.github/workflows/staging.yml`

## Acceptance criteria

- [x] Findings in BUILD-PLAN §7
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
wrangler deploy --dry-run
```

## Notes

- Scope as directed by the orchestrator: probe Workers, not the playground. Code is in `spikes/cloudflare/`
  (own `package.json`, outside the pnpm workspace; `pdf-lib` installed there for the S5 comparison only).
  The host mirrors `@emdash-cms/cloudflare` 1.2.0's sandbox runner (fresh loopback bridge per request,
  `globalOutbound: null`, `limits: { cpuMs: 50, subRequests: 10 }`). Raw results in `spikes/cloudflare/results/`.
- Measured: S1, S4, S5 (pdf-mini stand-in for T016 and pdf-lib, 1/3/5 pages), unique indexes on real D1,
  the `* * * * *` cron tick (6 ticks only). Findings in BUILD-PLAN §7 "Measured on Cloudflare"; decisions
  R22–R27 in §12. The "T007 local CPU" comparison uses Node `process.cpuUsage()` (`bench-local.mjs`),
  because T007's harness is not built yet; T007 should keep that method.
- Red: `node --test probe.test.mjs` failed on every probe with "PROBE_URL is not set" before deploy.
  Green: all probe tests pass against the deployed Worker.
- **Not done (needs a follow-up task):** `apps/playground/wrangler.jsonc` (Astro Cloudflare adapter,
  confirming S2 on Worker Loader, e2e on staging) and `.github/workflows/staging.yml` (nightly run);
  both need a CI Cloudflare API token from the owner. So "Nightly job green" is unchecked.
- Resources created and deleted: Worker `semics-probe-limits` (cron trigger, secret `PROBE_KEY`), D1
  `semics-probe-d1` (WEUR). Both deleted; `wrangler d1 list` shows no `semics-probe-*`, the Worker
  lookup returns 10007 (does not exist), no `semics-probe-*` KV namespaces.
- The task's verify `wrangler deploy --dry-run` was run against the probe config (`gen/wrangler.jsonc`),
  since the playground has no wrangler config yet.
