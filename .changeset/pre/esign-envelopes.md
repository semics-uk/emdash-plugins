---
"@semics-tech/emdash-esign": minor
---

Add envelopes: private `envelopes/create`, `send`, `get` and `list` routes, snapshots frozen at send with `docSha256`, the envelope status machine, and `public/envelopes/from-intent` (verified `esign-intent/1` intents, idempotent per `(cid, ref)`).
