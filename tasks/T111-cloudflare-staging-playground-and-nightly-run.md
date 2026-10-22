---
id: T111
title: "Cloudflare staging playground and nightly run"
phase: 1
package: repo
edition: free
status: backlog
model: opus-5.5
size: M
depends_on: [T110]
spec: [Spikes S1, S2, S5, EV-NFR-01, EV-NFR-02]
---

# T111 · Cloudflare staging playground and nightly run

## Definition

Deploy the playground to Cloudflare staging (Astro Cloudflare adapter, Worker Loader sandbox), confirm S2
(in-process public-route calls) on Worker Loader, run the e2e suite against staging, and add a nightly
staging workflow. Split from T110, which measured the limits with probe Workers.

## Model

**Opus 5.5**: First real deployment of the plugins; platform behaviour may differ from workerd locally.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [ ] e2e smoke against the staging URL fails before deploy (no `STAGING_URL`)
- [ ] One route's T007 budget figure compared with Cloudflare's reported CPU (R27)
- [ ] Nightly job green

## Implementation (green, then refactor)

- `apps/playground/wrangler.jsonc`, `.github/workflows/staging.yml`
- Name every Cloudflare resource with a `semics-staging-` prefix; record them in the Notes.

## Acceptance criteria

- [ ] S2 confirmed on Worker Loader and recorded in BUILD-PLAN §7
- [ ] Workflow uses a scoped Cloudflare API token stored as a GitHub secret (owner creates it; needs the GitHub repo)
- [ ] CI installs `qpdf` so the T016 `qpdf --check` test runs
- [ ] Lighthouse accessibility ≥ 95 on the booking widget and booking page (moved from T055: not installable offline locally)
- [ ] Linux CI regenerates the T054 card visual baselines once (macOS Chrome baselines, 3% tolerance)
- [ ] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
wrangler deploy --dry-run
```
