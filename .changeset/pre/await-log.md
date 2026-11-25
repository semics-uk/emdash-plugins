---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-esign": patch
---

T185 fix: plugin log lines now actually reach the site's log. In the sandbox `ctx.log` is a call to the host, and rc.35–36 didn't wait for it, so the call was dropped when the request ended. `report()` now waits, and so do the outbox drain, Turnstile, checkout and E-sign's own error lines (a signed PDF that doesn't match, or wasn't generated). A failing log never fails the caller.
