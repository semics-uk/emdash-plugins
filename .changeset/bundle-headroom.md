---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-esign": patch
---

Smaller sandbox backends with no change in behaviour. Events validates checkout bodies with a small built-in validator instead of `zod/mini` (same rules, same issue paths and codes), both cores drop unused shared code, and repeated helpers now exist once. The Events backend goes from 119.8 KiB to 95.1 KiB and E-sign from 100.9 KiB to 99.3 KiB, well under the registry's 128 KiB per-file limit.
