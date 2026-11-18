---
"@semics-tech/emdash-events": patch
---

Events no longer asks for the `schema:read` permission. Nothing in the plugin reads your collection schemas any more: the setup check that did now runs on the site at `/_events/setup` with your own admin sign-in. Fewer permissions, nothing to do.
