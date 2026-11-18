---
id: T180
title: "Drop schema:read from the Free Events trust contract"
phase: 8
package: events
edition: free
status: review
model: opus-5.5
size: XS
depends_on: [T178]
spec: []
---

# T180 Drop schema:read

Oli decided this on 2026-11-18, after T178.

- **Why it can go.** T178 moved the setup check to `/_events/setup`. That page reads collections through core's schema
  API, using the visitor's admin session. Nothing in the Free or Pro backend calls `ctx.schema`.
- **Changes in Free.**
  - `emdash-plugin.jsonc` capabilities are now `content:read`, `email:send`, `network:request`.
  - `trust-contract.json` was edited to match. Removing a capability narrows the contract, so this is a patch. Only
    adding one needs a major release with fresh consent.
  - Tests updated: `tests/manifest.test.ts` and `tests/trust-contract.test.ts`.
- **Changes in Pro.** The capability list comes from Free (`scripts/generate.mjs`), and
  `packages/events-pro/trust-contract.json` was edited to match.
