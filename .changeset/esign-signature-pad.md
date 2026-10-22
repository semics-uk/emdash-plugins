---
"@semics-tech/emdash-esign": minor
---

Add the signature pad to the signing page. With scripts on, the signer may also draw their signature (mouse, touch or pen) with keyboard-reachable Undo and Clear; typing the name stays required and works without JavaScript. The pad keeps vectors only (`{ v, w, h, strokes }`, whole-pixel points, at most 64 strokes), never an image. Its script is inlined and allowed by hash in the page's Content-Security-Policy. Fixes `/sign/[token]` calling the core under the default plugin id instead of the integration's configured one.
