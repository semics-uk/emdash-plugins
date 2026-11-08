---
"@semics-tech/emdash-events-suite": patch
---

Booking UI polish after rc.7 (T158). `<BookingWithWaiver>` fills its host column (it was capped at 38rem); set
`--events-widget-max` to cap it. Its Turnstile box keeps its full size whenever the form has room and uses the light
theme, and hovering a day or a time shows a light tint and ring rather than looking chosen.
