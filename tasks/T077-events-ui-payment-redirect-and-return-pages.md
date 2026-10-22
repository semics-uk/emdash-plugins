---
id: T077
title: "Events UI: payment redirect and return pages"
phase: 4
package: events
edition: pro
status: done
model: sonnet-5.5
size: S
depends_on: [T073, T055, T071]
spec: [EU-FR-09]
---

# T077 · Events UI: payment redirect and return pages

## Definition

Widget redirects to Stripe when `next` is `pay`; return page shows success, pending or failed.

## Model

**Sonnet 5.5**: UI wiring.

## Tests first (red)

Write these tests before any implementation and confirm they fail for the right reason.

- [x] Playwright with a faked Stripe redirect shows each outcome

## Implementation (green, then refactor)

- `src/astro/PaymentReturn.astro`

## Acceptance criteria

- [x] Accessible
- [x] After the last receipt, a paid waiver booking sits at `awaiting_payment` with no pay link (T065): continue now keeps signed attendees (T073); wire `/_events/waiver` to call continue again for the pay link
- [x] Meets the Definition of Done in `tasks/README.md`

## Verify

```sh
pnpm --filter @semics-tech/emdash-events verify
pnpm --filter playground e2e
```

## Notes

- Stripe's success and cancel URLs are both `/booking?ref=<ref>` (events-pro `returnUrlOf`), with no `session_id`
  placeholder, so the return page cannot tell "paid, webhook late" from "abandoned" by URL and does not try:
  `awaiting_payment` is one `pending` state that polls (3, 5, 8, 13, 21, 30 s) and also offers "Pay now" and
  "Check again". Nothing Stripe appends is read.
- `<PaymentReturn>` is rendered by `BookingPage`; the poll re-reads the page itself (the access token is HttpOnly), no
  new route. "Pay now" is `intent=resume` on `/booking` (Origin-checked like cancel/redeem), calling continue with the
  cookie token. Pay URLs are followed only when `https:` (checkout form, resume, suite).
- Suite: after the last receipt (`waiver=signed`) `/_events/waiver` continues the booking again and follows `pay`.
  Note: the booking cookie is scoped to `/booking`, so `/_events/waiver` never received it in a
  real browser; T067 fixed that independently (`semics_waiver_access_<ref>`), and this task reuses that cookie (set when the flow
  goes to sign, cleared when it ends) to ask for the pay link.
- E2E coverage (be exact): the playground runs Free only, so `/e2e/payment` renders the real BookingStatus,
  PaymentReturn and polling script for a booking whose status is faked by `?state=`; Stripe is a Playwright-faked host
  (the 303 to it is asserted on the response, since Chrome does not give a server redirect's hop to Playwright routes);
  polling uses a faked clock. NOT covered by e2e: Pro's `next: { type: "pay" }`, a real Stripe session, and the
  BookingPage wiring (source-scan test plus unit tests `packages/events/tests/ui/payment*.test.ts`, suite `flow.test.ts`).
- Port 4401 was held by an unrelated site during this run; the spec was run through a temporary copy of the config on
  another port (not committed).
