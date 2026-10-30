---
"@semics-tech/emdash-events": patch
"@semics-tech/shared": patch
---

The Free Events backend is 4.1 KiB smaller (120.9 KiB, R100, T136), so it again has room for a hotfix under its 125 KiB budget. Nothing changes for sites or buyers: code that the core carried more than once (status lists, sorting, booking lookups, new booking documents, emailed link codes, cron state, time formatting) now lives in one place. `@semics-tech/shared` adds `utcParts`, `pad2`, `validZone` and exports `WEEKDAYS`.
