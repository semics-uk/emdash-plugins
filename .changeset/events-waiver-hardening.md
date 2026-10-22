---
"@semics-tech/emdash-events": patch
---

Waiver bookings are sturdier. Once a booking is waiting for signatures, continuing it keeps the attendees it has (a changed name, email or "under 18" is refused with `ATTENDEES_LOCKED`), in the Free edition too, so a booking that was mid-signing when a site switched from Pro back to Free keeps its signatures. On Free, attendees a Pro waiver left pending get their pass and can be checked in. The booking page also reconciles a confirmed booking's seats that are still pending, and the door signing page records a waiver that was already signed by email. Return paths that resolve to `//host` are refused.
