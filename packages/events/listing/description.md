Event bookings for EmDash, built on your own content. Each entry of your events collection becomes bookable:
ticket types, capacity and holds that never oversell, a booking page, confirmation emails with calendar files,
self-service cancellation, a waitlist that offers freed seats, recurring events, attendee CSV export and
check-in from the admin.

- Works without JavaScript; tested against WCAG 2.2 AA at 320 px.
- English and Arabic built in, with right-to-left layouts.
- Asks only for `content:read`, `schema:read`, `email:send` and `network:request` to Cloudflare Turnstile.
- Booking data is erased after a period you choose; deletion on request from the admin.

The booking form and pages come from the npm package `@semics-tech/emdash-events` (the registry delivers the
core only).

Events Pro (same plugin, separate licence) adds paid tickets with Stripe, promo codes, attendee questions,
waivers through semics E-sign, QR passes with a check-in screen, reminders and broadcasts, sales reports and
MCP tools.

Documentation: https://github.com/semics-uk/emdash-plugins/tree/main/apps/docs/pages
