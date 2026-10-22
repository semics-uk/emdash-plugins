---
"@semics-tech/emdash-events": minor
"@semics-tech/emdash-esign": patch
---

The integration injects `/_events/opt-out`, the page behind the unsubscribe link in Events Pro's reminder and update emails: opening it changes nothing, its button asks the core's `public/mail/opt-out` (Events Pro). The self-scheduling flag moves to `cron:scheduled:v11` so sites already scheduled pick up Events Pro's `reminders` task.
