---
"@semics-tech/emdash-events": minor
"@semics-tech/emdash-esign": minor
"@semics-tech/shared": minor
---

Attendee signing list on the booking page (T133, R95; the routes behind it are Events Pro's). When Events Pro describes a waiver booking's seats, `/booking` lists every attendee as Signed or Waiting, with a "Sign now on this device" button (the attendee signs on the buyer's phone or a front-desk tablet; a minor's guardian signs for them), "Resend invitation" for adults invited by email, and a form to correct the names and emails of attendees who have not signed until the site's cutoff. Every action is a plain form post: no JavaScript is needed. Free shows nothing new. E-sign's `public/envelopes/from-intent` honours two optional intent fields (protocol §5.1, §8.1): `resend: true` emails the open envelope's invitation again with a fresh link, and `replace: true` voids the open envelope for the seat (audited as the integration) unless it already names that signer, and never creates one. An older e-sign ignores both.
