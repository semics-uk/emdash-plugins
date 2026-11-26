---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-esign": patch
---

Mail stuck in the outbox is reported: an `outbox-watch` task every 5 minutes writes one `outbox.stuck` error to the site's log for rows pending 15 minutes past their due time, each row once (T187).
