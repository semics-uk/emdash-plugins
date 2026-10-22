---
"@semics-tech/emdash-esign": minor
"@semics-tech/shared": patch
---

Unsigned envelopes now end: an hourly `expire` task closes `sent` and `in_progress` envelopes past their `expiresAt` (audited `envelope.expired`), so retention can purge them. Deletion on request by signer email also finds drafts (new indexed `signerEmail`). Automatic reminders stay Pro.
