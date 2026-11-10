---
"@semics-tech/emdash-events": minor
---

The booking page supports a waiver signed after payment (Events Pro's `waiverTiming: "after-payment"`): a paid
booking leads with "Last step: sign the waiver", whose button signs the next attendee on this device and emails
the other adults their waiver, and unsigned attendees read "Waiver pending" (T160). Bookings signed before
payment look as before. The Events backend is unchanged.
