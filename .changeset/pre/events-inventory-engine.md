---
"@semics-tech/emdash-events": minor
---

Add the inventory reservation engine: guarded `reserved` counters per ticket type, occurrence and event, reserved in a fixed order with compensation, plus drift repair from live bookings. `config/save` no longer rewrites counters: it updates changed fields with a guarded write, closes documents before deleting them, and refuses saves that would exceed the call budget (`TOO_MANY_CHANGES`).
