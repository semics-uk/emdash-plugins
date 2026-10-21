---
id: T029
title: "E-sign UI: descriptor and injected pages"
phase: 1
package: esign
edition: free
status: review
model: sonnet-5.5
size: S
depends_on: [T004, T006]
spec: [SU-FR-01, SU-FR-02]
---

# T029 · E-sign UI: descriptor and injected pages

## Definition

Add the `./ui`, `./astro`, `./client` and `./integration` entries to the e-sign package; the integration injects `/sign/[token]` and `/verify` pages with `Referrer-Policy: no-referrer`.

## Model

**Sonnet 5.5**: Follows the proven pattern.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Playwright: `/sign/<token>` renders the ceremony shell
- [x] Response header assertion for the referrer policy
- [x] Package exports resolve in the playground build

## Implementation (green, then refactor)

- Mirror the events package layout from T000

## Acceptance criteria

- [x] Registry bundle still contains only the core
- [x] The core's plugin ID is never hard-coded: it's a descriptor option (default the slug for npm installs) and the docs explain that registry installs use the `r_…` ID (S7, T005)
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```

## Notes

- Pages: `src/astro/SignPage.astro` (`/sign/[token]`) and `VerifyPage.astro` (`/verify`), logic in `src/astro/lib/sign.ts` (`handleSign`, `handleVerify`). Both send `Referrer-Policy: no-referrer` and `Cache-Control: private, no-store`; the token is only in the page path and POST bodies; `public/session` is always called before `public/submit` (R31) and the submit is bound to the session's `docSha256`.
- `lib/call.ts` is a copy of the Events helper (E-sign never imports Events), defaulting to `semics-esign`, with the T055 refusal unwrapping.
- Plugin id comes from `virtual:semics-esign/config`; `esignIntegration({ pluginId })`, README explains the `r_...` registry id.
- Typed signature only for now (drawn signatures, field values and a fuller ceremony UI belong to later tasks). The `./client` entry hashes a chosen PDF in the browser on `/verify`.
- Playground now sandboxes the e-sign core as well as Events, and `e2e/harness/build.mjs` builds the e-sign package. The e2e covers headers, the ceremony shell (defined error state for an unknown link) and no-JS `/verify`; a full signing journey needs an envelope fixture (later task).
- Added a node `ui-build` vitest project to e-sign for tests that read files. `src/plugin.ts` untouched; registry bundle is unchanged (core only).
