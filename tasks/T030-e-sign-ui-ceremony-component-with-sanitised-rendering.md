---
id: T030
title: "E-sign UI: ceremony component with sanitised rendering"
phase: 1
package: esign
edition: free
status: done
model: opus-5.5
size: M
depends_on: [T029, T024]
spec: [SU-FR-03..08, SU-NFR-01..03]
---

# T030 · E-sign UI: ceremony component with sanitised rendering

## Definition

`<SigningCeremony>`: render the snapshot Markdown through an allowlist sanitiser, consent checkbox with the core's wording, fields, typed signature, completion screen; strict CSP.

## Model

**Opus 5.5**: Security-sensitive rendering of sender-supplied content.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] XSS payload suite (≥ 40 payloads) never executes or survives sanitising
- [x] axe finds no serious violations
- [x] Sign stays disabled until consent, intent and required fields are complete
- [x] Works at 320 px wide

## Implementation (green, then refactor)

- `src/astro/SigningCeremony.astro`, `src/client/ceremony.ts`, sanitiser module

## Acceptance criteria

- [x] CSP header allows only the package's hashed script
- [x] Ceremony posts `{token, consent, intent, docSha256, signature:{kind, typedName?, strokes?}}` to `public/submit` (T024); renders `public/session` (snapshot text, `docSha256`, consent wording/version, signer name; `state: "closed"` for finished envelopes)
- [x] After submit, poll `public/session` until `pdf: "ready"` and show its `download` link (T025: the submit response carries none)
- [x] Builds on `SignPage.astro` + `src/astro/lib/sign.ts` (`handleSign`, T029: typed signature, consent/intent, decline, no-JS); add drawn signatures and field values without breaking the no-JS path
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-esign verify
pnpm --filter playground e2e
```

## Notes

- **Renderer.** `src/astro/lib/markdown.ts` (the sanitiser) parses the snapshot into a tree of allowed nodes
  (h2-h6 (document headings sit one level below the page h1), p, ul/ol, blockquote, pre/code, rule; strong, em,
  code, br, links). `SnapshotBlocks.astro`/`SnapshotInline.astro` render it only through `{text}`; the one
  data-derived attribute is a link `href`, limited to absolute http(s)/mailto by `safeHref`. Raw HTML, unsafe links
  and images stay literal text (images show their alt text and never load). It undoes `escapeValue` (five entities,
  backslash punctuation) so values read as typed, and a `<details>` shows the exact hashed text verbatim beside
  `docSha256`. Linear time (bracket pairs precomputed, delimiter searches memoised, nesting capped). Held at 100%
  branches (`vitest.config.ts` `strictBranches`).
- **CSP.** `ceremonyCsp()` (`src/astro/lib/csp.ts`, exported from `./astro`): `default-src 'none'`, `script-src` and
  `style-src` with exactly one hash each, `connect-src 'self'`, `form-action 'self'`, `base-uri 'none'`,
  `frame-ancestors 'none'`. To hash the script at render time it is inlined verbatim, so the client is **plain JS**:
  `src/client/ceremony.js` (+ `ceremony.d.ts`) imported with Vite `?raw` (deviation from the `ceremony.ts` name in
  the task). The two `set:html` uses are on these package constants only (a test pins that). A page embedding
  `<SigningCeremony>` (T-later `BookingWithWaiver`) must send `ceremonyCsp()` or add both hashes to its own policy;
  a site-wide Astro `security.csp` would be enforced alongside it.
- **Strokes shape.** The task text says strokes go to `public/submit` "in the `{ v, w, h, strokes }` shape", but the
  core's `parseSubmit` (T024) accepts `number[][][]` and `domain/pdf.ts` wraps them as `{ v: 1, w: 1, h: 1 }`. The
  core contract wins: `handleSign` takes the pad's `{ v, w, h, strokes }` from the hidden `signatureStrokes` input and
  `normaliseStrokes` turns it into 0-1 `[x, y]` points (3 decimals, clamped, ≤ 64 strokes, ≤ 32 KB JSON, else
  `STROKES_TOO_LARGE` before any call).
- **T031 slot.** `[data-esign-pad-slot]` holds `<slot name="pad" />` and `<input type="hidden" name="signatureStrokes">`.
  The pad writes its JSON there and dispatches a bubbling `input` event. Its script must also be inlined and hashed
  (add it to `assets.ts`/`ceremonyCsp`), or the CSP will block it. Typed name stays required with a drawn signature
  (it is sent as `typedName` beside the strokes).
- **Fields.** `public/session` sends no signer fields yet. `SessionData.fields?: {key,label,required?}[]` is rendered
  as `field.<key>` inputs and posted as `fieldValues`; required ones block Sign (client) and the submit (server).
  Follow-up for the core: expose signer-fillable fields in the session.
- **Polling.** After signing (and on a completed envelope revisited with `pdf: "pending"`) the script POSTs
  `{ token }` to `public/session` every 3 s, up to 60 times, and inserts the download link (same-origin paths only).
  No-JS keeps the "reload in a minute" text.
- **e2e.** `/e2e/ceremony` (playground) renders the component in fixed states (`?state`, `?doc=xss`, `?csp=off`);
  the XSS e2e runs with no CSP so the sanitiser is tested alone. The full send-sign-download journey is T033.
  Vitest: a new node project `ui` runs `tests/ui/markdown.test.ts` and `tests/ui/ceremony.test.ts`.
- `handleSign` still calls the core under the default plugin id (T029); the poll uses the integration's configured id.
- Automated code review of the diff is the orchestrator's step.
