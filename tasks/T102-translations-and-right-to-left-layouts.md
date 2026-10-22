---
id: T102
title: "Translations and right-to-left layouts"
phase: 7
package: repo
edition: free
status: review
model: sonnet-5.5
size: S
depends_on: [T078, T093]
spec: [EU-NFR-04, SU-NFR-06]
---

# T102 · Translations and right-to-left layouts

## Definition

Extract strings, ship `en` and one RTL language, verify layouts.

## Model

**Sonnet 5.5**: Mechanical extraction.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Snapshot tests in `en` and `ar`
- [x] No hard-coded strings (lint)

## Implementation (green, then refactor)

- `src/i18n/`

## Acceptance criteria

- [x] Docs on adding a language
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter playground e2e
```

## Notes

- Decision recorded as BUILD-PLAN §12 R58: translations live only in the UI kits (`packages/events/src/i18n/`,
  `packages/esign/src/i18n/`, exported as `./i18n`; en + ar). The sandboxed cores are untouched and still answer with
  codes: Free Events backend 118,653 B before and after, Free E-sign backend 107,472 B before and after
  (`bundle-size.build.test.ts` green). No backend refactor was needed.
- Language: the component's `locale` prop, else `Astro.currentLocale` (a site configures Astro i18n for its pages and the
  injected routes), else `en-GB`. No integration option was added, so the suite's virtual-module wiring is unchanged.
- Client scripts (booking, payment, check-in, ceremony, pad, verify) hold no text; the page renders theirs into
  `data-messages` / `data-free` / `data-message`. The e-sign CSP hashes follow the script files automatically.
- Tests: `scripts/i18n-strings.test.mjs` (no text in UI sources, no physical CSS sides, pages set `lang`/`dir`);
  `tests/ui/i18n.test.ts` in both packages (every key in every table, placeholders, en/ar snapshots of the UI helpers);
  `apps/playground/e2e/t102-i18n.spec.ts` (ARIA snapshots of both kits in en and ar, Arabic widget and ceremony mirror,
  320 px reflow and axe in Arabic). The widget-mirroring e2e passed in the red run too (its CSS was already logical); it
  stays as a guard. The full playground e2e passed (110 tests) on a temporary config at port 4471.
- Existing tests adjusted to the new contract: `formatMinor` takes the page's word for free, `checkInView` takes the
  messages, the verify script reads `data-messages`, `pdfDocumentView` adds `pagesLabel`, two source checks read the
  translated key, and the check-in e2e matches the translated status case-insensitively (English now says
  "(status: Cancelled)").
- Also translated: T083's `/_events/opt-out` page, which landed on main during this task.
- Follow-ups: the suite's own pages (`<BookingWithWaiver>`, `/_events/waiver`, `/_events/templates`) are not translated;
  emails, calendar files and the Block Kit admin (rendered by the cores) stay English in 1.0 (R58). Docs: `docs/i18n.md`.
