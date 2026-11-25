---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-esign": patch
---

T185 (#79): failed emails reach the site's own logs (ctx.log). A message's first failure logs one warning per tick (`outbox.send_failed`) and giving up logs one error (`outbox.gave_up`). Each line has the count, the email's kind and a scrubbed error. Provider errors are now scrubbed of email addresses too, in the log and in the stored row. Events still writes a line only while the cron tick has bridge calls to spare.
