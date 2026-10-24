---
id: T121
title: "Pro ships as public npm packages, unlocked by the licence key"
phase: 6
package: suite
edition: pro
status: in-progress
model: opus-5.5
size: S
depends_on: [T106]
spec: [R67, R84, R85]
---

# T121 · Pro ships as public npm packages, unlocked by the licence key

## Definition

Owner decision (2026-10-24): no paid npm plan for v1. Folding Pro into the Free sandboxed plugins is not
possible (the registry caps a plugin backend at 128 KiB; Events Free + Pro is about 325 KiB), so the
equivalent is: `@semics-tech/emdash-events-pro` and `@semics-tech/emdash-esign-pro` (and any Pro package
they need at install time) publish to npmjs.com as **public** packages under the existing proprietary
licence. Anyone can install them; nothing Pro works without a valid key from the licence Worker
(`licence.gate`, unchanged). The Pro source repo stays private. Buyers no longer get npm tokens (R67 changes).

## Acceptance criteria

- [ ] R85 recorded in `BUILD-PLAN.md` §12; R67 and §13 updated to point at it
- [ ] Pro publishing is `--access public` (release workflow, `scripts/npm-trust.mjs` bootstrap) with tests first; still no npm token (R84)
- [ ] Each published Pro `package.json` has the proprietary `license` (`SEE LICENSE IN LICENSE`) and ships the LICENSE file; `pnpm pack` dry run shows no source maps or tests
- [ ] The licence gate still blocks every Pro feature with no key, a wrong-host key and an expired key (existing tests pass; add one if a path is untested)
- [ ] `tasks/reviews/release-1.0.md` owner steps, the docs install page and the "each Pro sale" step say: buyer installs from npm, pastes the key; no paid npm plan
- [ ] Meets the Definition of Done
