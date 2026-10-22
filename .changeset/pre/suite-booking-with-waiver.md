---
"@semics-tech/emdash-events-suite": minor
---

New package (T065): `eventsSuite()` returns both sandboxed cores, both UI descriptors and the Astro integrations, passing each core's plugin id (descriptor id, or a registry `r_…` id) to every part. `<BookingWithWaiver>` books an event with one row per attendee and an "under 18" control, refuses names with control characters before booking, and on `/_events/waiver` redeems the waiver intents with E-sign (email `draft` answers count as sent), runs each inline ceremony under E-sign's CSP and forwards each receipt to Events in-process, landing on the confirmed booking.
