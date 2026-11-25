---
"@semics-tech/emdash-events-suite": patch
---

T184: after a refused voucher purchase, the buy form puts back the text fields, the message and the experience too, not only the radio choices. rc.33's restore loop had a dangling else. It now uses the booking form's keep-form helper: fresh for 5 minutes, once, and never through Back.
