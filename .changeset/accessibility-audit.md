---
"@semics-tech/emdash-esign": patch
"@semics-tech/emdash-events": patch
"@semics-tech/emdash-events-suite": patch
---

Accessibility fixes from the WCAG 2.2 AA audit (T101). On the sign page's email-code step, the code box has a hint. Every refusal shows inside the step and is linked to the box, and a wrong, expired or locked code marks the box invalid. Both of the step's forms return to the step (`#esign-otp`). A sign-form field to fix is described by the message that says why. The Turnstile security check switches to its compact size in a container narrower than 300 px, so the booking widget, the waitlist form, the booking-with-waiver form and the self-serve block do not scroll sideways on a 320 px screen.
