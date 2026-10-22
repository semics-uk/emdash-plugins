---
"@semics-tech/emdash-esign": minor
---

Add `<SigningCeremony>` (`@semics-tech/emdash-esign/astro/SigningCeremony.astro`), now used by `/sign/[token]`. The snapshot is parsed into a small allowlisted Markdown tree (headings, paragraphs, lists, quotes, code, emphasis, safe http(s)/mailto links) and rendered as escaped text only, with the exact hashed text and its SHA-256 beside it. The page sends a strict Content-Security-Policy (`ceremonyCsp()`) that allows only the ceremony's own inlined script and style by hash. With scripts on, Sign stays disabled until the consent box, intent box, typed name and required fields are complete, and after signing the page polls `public/session` and shows the signed PDF's download link. `handleSign` now also posts drawn signatures (pad `{ v, w, h, strokes }` normalised to 0-1 points, at most 32 KB) and session-declared field values; the no-JS form path is unchanged.
