---
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-esign": patch
"@semics-tech/emdash-events-suite": patch
---

Fixes from the LMSC staging test. `/booking` and `/_events/waiver` have a default look and take a site's theme, brand and stylesheet (`eventsSuite({ page })`). Times show in the event's own zone. The "Booking request" email says a decision is needed and by when, and notices about a booking already decided are not sent. A refused booking form keeps what was typed and, for a waiver signed per attendee, leaves no booking. A lapsed booking says how to start again. A decline shows its reason and says when the card was not charged. The admin Bookings list names the event. The attendee list shows while a booking awaits approval, with guidance for invitations that do not arrive.
