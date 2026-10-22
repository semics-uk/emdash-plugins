---
id: T093
title: "E-sign Pro: public self-serve templates and block"
phase: 6
package: esign
edition: pro
status: done
model: sonnet-5.5
size: M
depends_on: [T067, T071]
spec: [ES-FR-18, SU-FR-12]
---

# T093 · E-sign Pro: public self-serve templates and block

## Definition

`public/self-serve/start` with Turnstile and the `esign-request` Portable Text block.

## Model

**Sonnet 5.5**: Composes existing parts.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Self-serve creates an envelope for the visitor
- [x] Turnstile required
- [x] Block renders on a page

## Implementation (green, then refactor)

- `src/routes/self-serve.ts`, UI block

## Acceptance criteria

- [x] Within budget
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```

## Notes

- Public repo: the `esign-request` Portable Text block (`src/astro/SelfServeBlock.astro`, `lib/self-serve.ts`), the injected
  `POST /_esign/start` endpoint (cross-site check first, 303 back with `esign_start=sent|<CODE>`), the editor block in
  `esignUi()` and package exports. MIT source, no `@semics-tech/shared` import (R35). On Free `public/self-serve/start`
  stays the NOT_FOUND stub so the block renders "not available". No change to the Free backend (still 104.8 KiB of 112).
- Pro repo (branch `pro-agent-t093`): `public/self-serve/start` (describe + start, licence-gated), `pro/templates/self-serve`
  (private, marks a template: sets `public` and `selfServeDailyCap`), one-shot `self-serve-<id>`. See BUILD-PLAN R50:
  the signing link is only emailed (never returned), Turnstile is mandatory, honeypot, 5 starts per address per 10 minutes,
  per-template daily cap (default 50), and the usual `otpFlag` rule (code on by default for contract templates).
- Start is exactly 10 bridge calls (zero margin: no logging in that path). Admin UI for the marking is the private route only;
  a Pro admin page is a follow-up (Pro cannot add a Free page action without overriding the Free admin route).
- Residual risk recorded in R50: many addresses with solved challenges can email one victim up to the daily cap.
- Playground e2e covers only the Free (unavailable) state, because the playground never runs Pro code.
