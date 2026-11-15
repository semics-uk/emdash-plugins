---
"@semics-tech/emdash-events-suite": patch
"@semics-tech/emdash-events": patch
---

"Book with this voucher" (T171), opt-in with `eventsSuite({ vouchers: { core, book: true } })` (or
`book: { listPath }`; a bare Vouchers core keeps today's wiring). The voucher page `/_vouchers/v?c=<code>` shows the
button when there is somewhere to book: an activity voucher goes to its event's booking form (`page.eventPath`) with
its ticket type chosen, a money voucher to the page listing the activities (default `/events`). With nothing left on
the voucher, or an event Events does not list on sale, there is no button and the page keeps its how-to-use line.
voucher/1 §8 keeps the code out of booking URLs: the button is the voucher page's own link with `&book=1`, which sets a
30-minute HttpOnly cookie (`semics_voucher`) and redirects with no referrer. Events' `<BookingWidget>` and the
suite's `<BookingWithWaiver>` fill the Gift voucher field from that cookie on the server, preselect `?ticketType=`,
carry a `#book-<event>` anchor and a "Have a gift voucher?" link to the field; the booking page clears the cookie once
a booking used a voucher. Site-side only: the Events core bundle is unchanged.
