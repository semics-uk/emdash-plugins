---
"@semics-tech/emdash-events": patch
---

Booking UI polish after rc.7 (T158). `<BookingWidget>` fills its host column (it was capped at 38rem); set
`--events-widget-max` to cap it. Its Turnstile box keeps its full size whenever the form has room (it could pick the
compact size on a desktop) and uses the light theme. Hovering a day or a time shows a light tint and ring, no longer
easy to mistake for the chosen one. On `/booking` the payment box and the attendee list are cards like the others, with
the same edges. A ticket pass with a QR no longer prints its 43-character check-in code in large type: "Show the code to
type in" reveals it on screen, and a printed pass carries it on one small line under the QR; a pass without a QR shows it
smaller, in groups of four. The code itself, and what door check-in accepts, are unchanged. `AttendeeList.astro` is now
exported.
