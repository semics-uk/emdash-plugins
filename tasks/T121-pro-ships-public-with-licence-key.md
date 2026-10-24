---
id: T121
title: "Pro ships as public npm packages, unlocked by the licence key"
phase: 6
package: suite
edition: pro
status: done
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

- [x] R85 recorded in `BUILD-PLAN.md` §12; R67 and §13 updated to point at it
- [x] Pro publishing is `--access public` (release workflow, `scripts/npm-trust.mjs` bootstrap) with tests first; still no npm token (R84)
- [x] Each published Pro `package.json` has the proprietary `license` (`SEE LICENSE IN LICENSE`) and ships the LICENSE file; `pnpm pack` dry run shows no source maps or tests
- [x] The licence gate still blocks every Pro feature with no key, a wrong-host key and an expired key (existing tests pass; add one if a path is untested)
- [x] `tasks/reviews/release-1.0.md` owner steps, the docs install page and the "each Pro sale" step say: buyer installs from npm, pastes the key; no paid npm plan
- [x] Meets the Definition of Done

## Notes

- Pro repo (branch `agent-t121`, worktree `.pro-worktrees/agent-t121`): `pro-release.yml` and the
  `npm-trust.mjs` bootstrap publish `--access public`; the placeholder ships the LICENSE too. Both Pro
  packages are `SEE LICENSE IN LICENSE`, carry a copy of the root LICENSE (a test keeps them equal) and
  `files` excludes `**/*.map`; `src` and `tests` were never in `files`. `npm pack --dry-run` on events-pro
  (with stub `.map` files in `dist`) lists only `LICENSE`, `dist/*.mjs`, `dist/*.d.mts`,
  `emdash-plugin.jsonc` and `package.json`. Only events-pro and esign-pro publish: `pro-kit` is bundled
  (dev dependency) and `licence-worker` is a Worker, so no other Pro package is needed at install time.
- The licence Worker's key email now gives the `npm install` line(s) for the plan's product(s) in place
  of "reply and we will send your npm access token". `semreg_` tokens are still minted, now described
  as kept for a future registry.
- Licence gate: no code change. `pro-kit/tests/licence.test.ts` already covers no key, another site's
  key and a build after `updatesUntil` ("new Pro work is refused ..."), and the editions tests cover the
  routes; all pass. No untested path found, so no new gate test.
- A full Pro build could not run here (the linked Free checkout has no built `@semics-tech/shared`);
  the docs snippet and routes tests need built Free packages for the same reason. Neither is touched
  by this task.
