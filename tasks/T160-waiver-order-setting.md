---
id: T160
title: "Configurable waiver order: sign before payment (default), after payment, or off; and a no-decline option"
phase: 7
package: events-suite
edition: free
status: in-progress
model: opus-5.5
size: L
depends_on: [T159]
spec: []
---

# T160 · Waiver order setting

## Source

semics-tech/lmsc-site#21 (opened by the club, 2026-11-10): take payment before the waiver, require a signature, no way
to decline or skip, step numbers and wording to follow the new order. Decisions relayed from Oli by the LMSC session:
make it configurable rather than LMSC-only; someone who pays but never signs keeps their place and signs on arrival (no
refund, not turned away).

## Definition

1. **Settings.** A site default plus an override per event (or per ticket type, if that falls out naturally):
   - `waiverTiming`: `before-payment` (today's flow; the default, unchanged for existing sites) / `after-payment` / `off`.
   - `allowDecline`: on (default) / off. Off hides the Decline button on the waiver ceremony for that booking and leaves no
     path to finish the waiver step without a signature.
   Admin UI to set them, and documented config keys (name them in the docs and in this file).
2. **After-payment flow.** Book, pay, then sign. After a successful payment the booking is confirmed straight away and
   each unsigned attendee shows as "Waiver pending". The customer is taken from payment to signing; the signing link
   is on the confirmation page and in the confirmation email. Signing later updates the attendee to Signed. Paid but
   never signed: the booking stays confirmed (no refund, no lapse), and staff see "Waiver pending" in the attendee list
   and at check-in so they can get it signed on arrival.
3. **Free (no payment).** With `after-payment` on a free ticket, behave like `before-payment` (there is no payment to
   go first), or confirm then sign: choose, document why.
4. **Steps and wording.** The booking flow's step numbers, headings and wording follow the chosen order, on the widget,
   the waiver page, the confirmed page and emails.
5. **`off`.** No waiver step even when a template is paired.

## Constraints

- The Events backend bundle (`packages/events/dist/plugin.mjs`) has about 33 bytes of room (123,871 bytes). Investigate
  first where the order lives (Events `public/checkout/*`, the suite's `astro/lib/flow.ts`, Pro's payment path) and put
  as much as possible outside the Events backend. If it cannot fit, stop and report the options with sizes; do not
  raise the budget.
- Default behaviour for every existing site stays exactly as today; existing tests pass unchanged.
- TDD, tests failing first; Playwright for the after-payment journey (the T159 journey harness, with Pro where linked).

## Acceptance criteria

- [ ] Settings with documented keys; default unchanged.
- [ ] After-payment journey: book, pay, sign; confirmed with "Waiver pending" before signing, Signed after; link on the
      confirmed page and in the email; staff see pending in attendee list and check-in.
- [ ] Decline off: no Decline button, no way past without a signature (server-side too, not just hidden).
- [ ] Step numbers and wording follow the order.
- [ ] Bundle within budget; changesets; `pnpm verify` and e2e pass.

## Notes

### Plan (investigation, before coding)

Where the order is decided today: Free `public/checkout/continue` (`continueCheckout`): a booking with `waiver` in `held`
or `awaiting_signature` goes to the Pro signature step, so signing always comes before `pay`. The booking's `waiver` is
copied from the event config at reserve (`waiverOf`). Pro composes continue, reserve, `public/event`, `public/booking`,
`admin` and the outbox job from the Free routes and already wraps reserve/`public/event`/`public/booking` storage to
add questions, promo codes and the signing list (`overStorage`). Waivers are Pro-only, so the whole setting can live
in Pro, with no change to the Events backend:

| Piece | Where | Events backend bytes |
| --- | --- | --- |
| Site defaults `waiverTiming`, `waiverAllowDecline` | Pro `pro.json` settings (overlay manifest) | 0 |
| Per-event override (admin form under the ticket panel, stored on the event config like questions) | Pro panel wrapper | 0 |
| Stamp the order on the booking at reserve (`waiver.after`, `waiver.noDecline`; `off` drops `waiver`) | Pro reserve wrapper (config and settings are already read by Free) | 0 |
| Skip signing before payment | Pro continue wrapper hides `waiver` from Free's read of a `held` after-payment booking, so Free goes straight to `pay`; the stored booking keeps its waiver, so the webhook leaves the seats `pending` (Waiver pending) | 0 |
| Sign after payment | Pro route `public/booking/waiver` (intents for every unsigned seat, emailed adults' invitations idempotent); Events UI booking page shows "Sign the waiver" step | 0 (UI is Astro, outside `plugin.mjs`) |
| No decline | `esign-intent/1` optional field `noDecline` (like `signBy`); E-sign stores it on the envelope, hides Decline, `public/decline` refuses (`DECLINE_NOT_ALLOWED`... an existing code) | 0 (E-sign has ~6 KB room) |
| Wording/steps | suite widget and waiver page, Events booking page (Astro), confirmation email via a Pro wrapper on the outbox job's send | 0 |
| Staff see Waiver pending | Pro admin wrapper on the attendees table; check-in already refuses pending seats with the door link | 0 |

Free tickets with after-payment: sign first (as before-payment), because there is no payment to go first and signing
before confirming keeps the free place tied to a signature; documented. Waivers signed once per booking (`buyer` mode)
keep before-payment (Sign now and the signing list are per attendee). Budget: Events backend stays at 123,871 bytes.
