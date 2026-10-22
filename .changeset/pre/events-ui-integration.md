---
"@semics-tech/emdash-events": minor
---

Add the `./integration` entry (`eventsIntegration({ pluginId })`): injects the no-JS checkout endpoint `/_events/checkout` and the `/booking` page (`Referrer-Policy: no-referrer`, access token in an HttpOnly cookie, never in a URL). Registry installs pass their `r_…` plugin id.
