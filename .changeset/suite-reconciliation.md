---
"@semics-tech/emdash-events-suite": minor
"@semics-tech/emdash-events": minor
---

Reconcile waiver bookings and refresh the e-sign template catalogue. Events: `public/booking` lists the refs a waiver booking still waits for (`waiver.refs`, and with Pro a lookup request for each), `public/event` says `waiver: true` when a waiver is required, a retry of `public/checkout/continue` without attendees keeps the stored ones, the editor panel's template field becomes a select of the cached catalogue with a Refresh templates button (Pro), and `eventsIntegration({ reconcile })` lets the booking page run the suite's reconciliation. Suite: the booking page forwards the receipts e-sign already holds (a signer who closed the tab or signed by email), `/_events/templates` loads the catalogue, a refused signing intent offers "Try again" instead of leaving the booking held, and `<BookingWithWaiver>` shows attendee rows only for events that require a waiver.
