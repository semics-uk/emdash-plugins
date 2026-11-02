---
"@semics-tech/emdash-esign": patch
---

`integrations/pair` takes an optional `clientId` (the client in Events' stored pairing). A hand-made client an administrator pasted into Events is now reported as active, and pairing again adopts it as the site client instead of creating a second one; the auto-pair client it replaces is revoked, as is the site client on unpair.
