---
"@semics-tech/emdash-esign": minor
"@semics-tech/shared": patch
---

Envelopes with several signers (made by E-sign Pro) are handled safely by the Free core: each signer's first view and decline is recorded as their own audit event (`data.signer`), Free never completes such an envelope (a signature is refused with `ENVELOPE_CLOSED` and nothing is written, so a site switched back from Pro keeps a half-signed envelope intact), the signed PDF and certificate list every signer, and the signing page shows a waiting state while other signers still have to sign. New `ceremonyHandlers` seam (`src/seams.ts`) for an edition that routes several signers, a `SIGNING_OUT_OF_TURN` error code, and the schedule flag moves to v7 for the Pro `reminders` task.
