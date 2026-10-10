---
id: T110
title: "Cloudflare staging and platform-limit measurements"
phase: 0
package: repo
edition: free
status: blocked
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

- [ ] Probe route records the subrequest failure point
- [ ] PDF benchmark recorded for 1, 3 and 5 pages
- [ ] Nightly job green

## Implementation (green, then refactor)

- `apps/playground/wrangler.jsonc`, `.github/workflows/staging.yml`

## Acceptance criteria

- [ ] Findings in BUILD-PLAN §7
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
wrangler deploy --dry-run
```
