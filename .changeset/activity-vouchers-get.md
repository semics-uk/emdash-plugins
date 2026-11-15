---
"@semics-tech/emdash-events-suite": patch
---

`/_vouchers/setup` now reads Events' catalogue (`public/events`, `public/event`) with GET. It used POST, which those routes refuse, so the page said "Events' catalogue could not be read", no activities could be saved and the buy form only offered money vouchers.
