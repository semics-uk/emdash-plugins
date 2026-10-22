---
"@semics-tech/emdash-esign": minor
"@semics-tech/emdash-events": patch
---

E-sign: signing intents now only start envelopes from templates marked "Available to integrations" (a new toggle on the template forms; existing templates start switched off, so turn it on for the templates your Events site uses). Consumed intent nonces are deleted by an hourly `nonce-sweep` task once they can no longer be replayed. Both cores re-run their one-time schedule check after this update so the new task is scheduled.
