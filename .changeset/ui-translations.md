---
"@semics-tech/emdash-esign": minor
"@semics-tech/emdash-events": minor
---

Translations and right-to-left layouts for the UI kits (T102). Every text the Events and E-sign components, pages and client scripts show now comes from `src/i18n` (exported as `./i18n`), which ships English and Arabic. Components take a `locale` prop; without one they use the page's locale when the site configures Astro i18n, else British English. Each component sets its own `lang` and `dir`, the injected pages set them on `<html>`, and the styles use logical sides, so Arabic pages mirror. Client scripts read their messages from the page instead of carrying English. The sandboxed cores are unchanged: they still answer with codes, and the message tables stay out of the backend bundle. `docs/i18n.md` explains how to add a language.
