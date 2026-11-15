---
id: T171
title: "Book with this voucher: from the voucher to the booking form"
phase: 8
package: events-suite, events, vouchers-pro
edition: pro
status: review
model: opus-5.5
size: S
depends_on: []
spec: []
---

# T171 · Book with this voucher

Reported from the LMSC client's first activity-voucher purchase. The voucher page and the emails only said "Enter the
code in the Gift voucher field when you book", and customers could not see how to use the voucher.

## Definition

1. **A "Book with this voucher" button** on the voucher page (`/_vouchers/v?c=<code>`) and in the voucher emails.
   An activity voucher goes to its event's booking form with its ticket type chosen; a money voucher to the page
   listing the activities. With nowhere to book (online booking off, a voucher with nothing left, or an activity whose
   ids Events does not know), no button, and the current how-to-use line stays.
2. **The booking form takes the code** from the voucher (filled in) and a ticket type (`?ticketType=<id>`).
3. **"Have a gift voucher?"** near the booking form, opening or focusing the code field without JavaScript.

## Acceptance criteria

- [x] Tests first in both repos (a failing-test commit, then the fix).
- [x] The code travels in no URL voucher/1 §8 does not allow; `Referrer-Policy: no-referrer` on the hand-off.
- [x] A config switch on `eventsSuite({ vouchers })`, and a fallback when the event cannot be found.
- [x] Free Events backend bytes unchanged; Vouchers Pro bundle size reported (budget 100 KiB).
- [x] Playground journey extended (`t168-vouchers`, Pro build).
- [x] Changesets: events-suite and events patch (public), vouchers-pro patch (Pro).
- [ ] Reviewed and merged (PRs open; not released).

## Notes

- **The code in a URL (decision to check).** voucher/1 §8: codes "MUST NOT appear in query strings, paths or logs",
  except the voucher page link `/_vouchers/v?c=<code>` (no-referrer). So `?voucher=CODE` on a booking URL is not
  allowed and is not built. Chosen instead: the button (on the page and in the emails) is the voucher page's own link
  with `&book=1`. That request sets a 30-minute HttpOnly cookie `semics_voucher` (SameSite=Lax, path `/`, Secure on
  https) with the display code and answers a 303 to the booking form, with `Referrer-Policy: no-referrer` and
  `Cache-Control: private, no-store`. The form fills its Gift voucher field from the cookie on the server, so it
  works without JavaScript, and no booking URL, referrer or server log carries the code. The protocol doc's §8 now
  says the `&book=1` form is the same exception. A URL fragment (`#voucher=`) was rejected: it needs JavaScript and
  still leaves the code in browser history on the booking page. The precedent is Events' promo code, already an
  HttpOnly cookie.
- **Cache risk.** A booking form that filled in a code sets `Cache-Control: private, no-store` (best effort: inside a
  component Astro may already have sent the headers). The cookie only exists for the buyer who followed the link, but
  an event page behind a shared cache that ignores cookies could cache a filled-in form. Neither the playground nor
  LMSC caches event pages that way; recorded in `docs/vouchers.md`.
- **Opt-in.** `vouchers: { core, book: true }` (money vouchers go to `/events`) or `book: { listPath: "/whats-on" }`.
  A bare core (`vouchers: vouchersPro`) is wired exactly as before, so LMSC live (online booking off, staff redeem by
  hand) sees no change. The emails need Vouchers' own setting `emailBookLink` (off by default): Vouchers cannot read
  the suite's config. The event page is `page.eventPath` (default `/events/{slug}`), as "Book again" uses.
- **Where the button goes.** Activity: Vouchers' voucher view now names `eventId` and `ticketTypeId` (activity only;
  a money view is unchanged). The page asks Events' `public/events` (one listing, cached 60 s, at most 100 events) and
  links only when that event is listed `on_sale` with a slug: `<eventPath>?ticketType=<id>#book-<event>`. Unknown
  ids (Vouchers never checks them), a closed event, Events unreachable, or an older Vouchers build without the ids:
  no button. Money: `listPath`. Nothing left (`balanceMinor`/`usesLeft` 0) or not `active`: no button, and `&book=1`
  just shows the voucher page. The money list is the site's own events index (reused; no new page): the code rides in
  the cookie, so its "Book" links need nothing added.
- **The forms.** Both `<BookingWidget>` (Events) and `<BookingWithWaiver>` (suite) put `id="book-<event>"` on the
  form (one anchor that works whichever the site uses), fill the field from the cookie (display form only, else
  nothing), preselect `?ticketType=` when offered (the widget sets that type's quantity to 1; the waiver form selects it
  in the plain select and the first attendee row) and show "Have a gift voucher?" (an anchor to the field; `:target`
  outlines it). The helpers are Events' `astro/lib/book-link.ts` (site-side, shipped as source). Events' `/booking`
  deletes the cookie once a booking carries a voucher, so a spent activity voucher is not offered again.
- **Emails.** With `emailBookLink`, both the receipt and the gift email add
  `Book with this voucher: <origin>/_vouchers/v?c=<code>&book=1` after "View or print it". The how-to-use line stays.
- **Bytes:** Free Events `plugin.mjs` 119,392 B before and after (the changes are UI-side: `src/astro`, i18n). Vouchers
  Pro `plugin.mjs` 69,680 → 69,903 B (+223 B) on Pro `main`; with T170 as well, 71,201 → 71,424 B (budget 100 KiB).
- **Pro e2e** (`EMDASH_PRO_DIR` = a throwaway Pro checkout of T170's branch plus these commits, since public `main`
  already expects T170's thanks page): `t168-vouchers` 10/10 passed, including the three new T171 journeys (activity
  voucher from the email's link, money voucher through the list, spent voucher without a button). One earlier run
  failed once inside the shared `buy()` helper (the thanks page navigation was interrupted, `chrome-error://`), before
  any T171 step; the rerun passed.
- **Pro branch base.** Pro `main` does not have T170 yet (PR #8 open); this branch is from `main` as briefed. Both
  touch `webhook.ts` (`finishIssue`), so whichever lands second rebases.
