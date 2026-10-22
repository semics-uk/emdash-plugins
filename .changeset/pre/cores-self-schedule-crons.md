---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-esign": patch
---

Schedule recurring cron tasks even when EmDash never runs `plugin:activate`, which is the case for cores listed under `sandboxed: [...]` in `astro.config.mjs`. Events now sweeps expired holds and sends its emails on an npm/config install, and E-sign drains its outbox. The first public event read, admin page load, template creation or verify-page call schedules them once.
