---
"@semics-tech/emdash-esign": minor
---

Add the hash-chained audit trail (`audit_events`): `hash_n = SHA256(hash_n-1 ‖ event)` over salted commitments of personal fields, so the retention purge never breaks verification; create-only appends that never fork; an exported chain verifier and `finalEnvelopeHash`. Envelope create, send and from-intent now write `envelope.created` / `envelope.sent` events, and every envelope carries a private `piiSalt`.
