---
"@semics-tech/emdash-esign": minor
---

Retention (ES-FR-22): a daily `retention` job deletes personal data once the personal-data period has passed (default 12 months after an envelope closed) and the signed record (PDF, document, audit trail) once the signed-records period has passed (default 7 years). The audit chain still verifies after the first purge and `/verify` still matches the signed PDF until the second. Open envelopes are never touched. The Envelopes page can delete one signer's or one envelope's personal data on request. Smaller backend: packed font metrics and one shared ISO-time helper.
