---
"@semics-tech/emdash-esign": minor
---

An envelope can carry an uploaded PDF as its document (`document`, E-sign Pro's PDF templates): `public/session` describes it (file name, size, pages; no text snapshot is read) and the signing page offers links to open or download it beside its SHA-256, never an embed. The Free core never signs such an envelope (`ENVELOPE_CLOSED`, nothing written) because it cannot show or stamp the PDF; declining still works.
