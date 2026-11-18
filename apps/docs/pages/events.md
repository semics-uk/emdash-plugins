# Events guide

semics Events turns entries of your events collection into bookable events. The entry stays yours: the
plugin never writes to it. Tickets, dates, bookings and attendees live in the plugin's own storage.

## Make an event bookable

1. Create and save an entry in the events collection (it needs a start).
2. In the entry editor, open the **Tickets & booking** panel and choose **Enable booking**. Give the event a
   capacity and a currency.
3. Add ticket types (name, price, capacity) and set **Sales status** to `on_sale`.
4. Put a booking form on the event's page ([Pages and components](site-pages.md)).

Sales status is one of `draft`, `on_sale`, `paused`, `closed` and `cancelled`. Only `on_sale` takes bookings.
A draft event, an unpublished entry and a deleted entry are not shown to the public at all.

In the Free edition every ticket must be free (price 0). A priced ticket needs Events Pro and Stripe
([Paid tickets](payments.md)); on Free its checkout stops with "Payment could not be started".

### The editor panel and other collections

The **Tickets & booking** panel is scoped to the `events` collection in the manifest. EmDash shows a panel
only on the collections its manifest names, and the manifest is fixed when the plugin is built. If you map
another collection in the settings, the panel does not appear on its entries; it appears only on entries of
a collection called `events`.

The **Event editor** admin page works for any mapping. It lists the events with booking settings and its
**Edit** button opens the same Tickets & booking panel there (waivers are set on the entry's panel). Use it
when your events live elsewhere.

We checked whether the panel could follow the setting: EmDash 1.2 cannot scope a panel's collections at run
time. The list is a static field of the manifest. Leaving it out would show the panel on every collection,
and a change to the manifest needs a new plugin release.

## Limits

| What | Limit |
| --- | --- |
| Ticket types per event | 25 |
| Dates (occurrences) per event | 100 |
| Lines per order / tickets per line | 10 / 50 |
| Bookings per visitor IP | 10 in 10 minutes (see [Configure](configure.md#client-ip-addresses-and-proxies)) |
| Waitlist joins per visitor IP | 5 in 10 minutes |
| Hold on free tickets / paid tickets / ceiling | 15 / 35 / 60 minutes (settings) |
| Emails sent | two emails a minute |

## How a booking works

1. The visitor picks tickets on the booking form and enters a name and email. The form works without
   JavaScript.
2. The plugin holds the seats, then confirms a free booking at once. Seats are never oversold: every count is
   checked as it is written.
3. The visitor lands on `/booking`, which shows the booking, ticket passes and a link to add the event to a
   calendar. An HttpOnly cookie remembers the booking on that browser.
4. A confirmation email follows. Its link opens the booking on any device. The link holds a one-time code,
   valid for 7 days. Opening the link shows a button; pressing it swaps the code for access, so a mail
   scanner that opens the link does not use it up.

Holds expire on their own. A job every 5 minutes releases expired holds and puts the seats back on sale.

A confirmed booking on `/booking` leads with the event, its date and time in the event's time zone, and the place.
Below the tickets are "Add to calendar" and "Print or save as PDF" (shown when JavaScript runs; the browser's own
Print uses the same layout: no buttons or brand bar, the organiser's name and address kept).

The calendar link on the booking page is a signed link valid for 15 minutes. The plugin also serves a public
calendar file for each event on sale.

### Cancelling

Buyers cancel from `/booking`: "Cancel booking", at the foot of the page, opens a confirmation. A confirmed booking can be cancelled until **Self-service cancel cutoff** hours
before the start (default 24). After that the page says "This booking can no longer be cancelled online".
Seats go back on sale and a cancellation email is sent. In Free, a paid booking cannot be cancelled online;
Events Pro refunds it in full first.

### Approving bookings

Set **Approval hours** in the panel (0 turns approval off) to check each booking by hand. After any waiver
and payment step the booking is **Awaiting approval**: its places stay reserved, the buyer gets a "request
received" email and the booking page says by when you decide. The deadline is the approval hours after the
booking, but never later than the start of the booked date. On the **Bookings** page, **Approve** confirms
it and sends the usual confirmation with its calendar link; **Decline** asks for an optional reason, which
goes in the email to the buyer, and puts the places back on sale. A request nobody decides in time expires,
its places are released and the buyer is told. The buyer may cancel a request at any time.

Admins named in **Admin notification emails** (up to 5) are emailed about requests, or about every booking
if **Notify admins about** says so; the email links to the Bookings page, so only signed-in staff can act.
Admin notifications work without approval too. With Events Pro, a paid booking that is declined is refunded.

### Booking requests (a time to be agreed)

For an activity booked by request, fill in **Booking requests** in the panel instead of dates or a schedule:
the time windows, one a line (`AM 10:00-12:00`, `PM 12:00-15:30`), the days they run (`SA, SU`), how many
days ahead people may ask (default 90), the days' notice you need, and closed dates (`2026-12-25`). The
booking form then asks for a date (only the days you take) and a window, and the buyer sees "Request sent:
we'll confirm a time with you." A request always waits for approval, even with **Approval hours** at 0 (then
48 hours), and never past the start of the window asked for. Its emails say "time to be agreed".

On the **Bookings** page a request shows what was asked for ("Requested: Sat 12 Dec, AM"). Its **Approve**
opens **Confirm time**: a date and start time (from the request, in the event's time zone) and an optional end.
Confirming sends the usual confirmation with that time, which the booking page, the calendar file and the
cancel cutoff then use. **Decline** works as for any request.

#### Windows that change by weekday or season

An event's windows can differ by weekday, date range and daylight-saving season. Rules are set through the
`config/save` route only (the panel has no field for them, and saving the panel keeps them as they are):
`config.requests.rules`, up to 10, each with:

- `days` (optional): weekdays `MO` to `SU`;
- `from` and `to` (optional, both or neither): `MM-DD`, inclusive; `from` after `to` wraps the year
  (`12-20` to `01-05`);
- `summer: true` (optional): only while the event's time zone is on daylight-saving time, whatever the year
  ("until the clocks go back");
- `windows`: 1 to 8 windows, as in `requests.windows`.

A rule applies to a date when all its conditions hold; the first rule that applies replaces the usual windows
for that date. Window ids must be unique across `windows` and every rule, since a booking keeps only the id.
The booking form shows only the chosen date's windows (without JavaScript it lists them all, and checkout
refuses one the date does not offer).

For example, Morning and Afternoon every open day, but Wednesdays from April until the clocks go back offer
only the late windows:

```json
{
  "requests": {
    "windows": [
      { "id": "morning", "label": "Morning", "start": "10:00", "end": "12:00" },
      { "id": "afternoon", "label": "Afternoon", "start": "12:00", "end": "15:30" }
    ],
    "days": ["WE", "SA", "SU"],
    "aheadDays": 90,
    "noticeDays": 0,
    "closedDates": [],
    "rules": [
      {
        "days": ["WE"],
        "from": "04-01",
        "to": "10-31",
        "summer": true,
        "windows": [
          { "id": "late-1", "label": "Late 1", "start": "15:30", "end": "17:00" },
          { "id": "late-2", "label": "Late 2", "start": "17:00", "end": "18:30" }
        ]
      }
    ]
  }
}
```

`config/save` takes the whole event config (`{ eventId, config, ticketTypes, occurrences }`), so read it with
`config/get` first, add `rules` to its `requests`, and save it back.

### Per-person add-ons (Events Pro)

An extra sold per person rather than as a place, such as quad trekking at £54 a person, is a ticket type marked
**Add-on (per person, not a place)** in the panel's **Add-ons and packages** form. The booking form lists add-ons under the
tickets, and a booking can have at most one of each for every place it books (an order of add-ons alone is
refused). An add-on is priced like any ticket (quantity × price) and shows on the booking page, but it takes no
place from the event or the date and has no attendee or waiver. Its own capacity is its stock. Requests and
normal bookings both take add-ons.

### Party packages (Events Pro)

A price for a group, such as "up to 5 people, 60 shots, £120", is a ticket type marked **Package (one price for
the group)** in the same form. Its price is the package price, and its minimum and maximum per order are the
fewest and most people it takes. The booking form asks "How many people?" (from the minimum to the maximum) and
charges the package price once. Each person still takes a place from the event or date, has an attendee row and
signs their own waiver, and per-person add-ons are capped at one each for those people. Requests take packages
too, including when names are added after the time is confirmed.

## Waitlist

Turn on **Waitlist when sold out** in the panel. When the event (or a date) is sold out, the booking form
offers a "Join the waitlist" form instead: name and email, one entry per person, event and date.

When seats come free, a job (every minute) offers them to the earliest entry that fits. The offer is a held
booking in that person's name, kept for 24 hours, and an email with a link. Pressing **Claim my tickets**
confirms it. An offer nobody claims is released like any hold, and the next person gets the seats. Waitlist
entries are personal data: they are deleted after the retention period and by a deletion request.

There is no separate waitlist page in the admin in 1.0: an offer shows on the **Bookings** page as a held
booking in the person's name, and a deletion request by email also removes their waitlist entries.

## Recurring events

Type a rule in **Repeats (RRULE)**, for example `FREQ=WEEKLY;BYDAY=TU;COUNT=10`. The series starts at the
entry's start, in the entry's time zone, and keeps that local time across clock changes.

- Supported: `FREQ` `DAILY`, `WEEKLY` or `MONTHLY`; `INTERVAL`; `BYDAY` (with an ordinal such as `1MO` or
  `-1FR` only when monthly); `BYMONTHDAY`; `COUNT` or `UNTIL`. To skip dates add `EXDATE=20261224,20261231`
  (local dates). Weeks start on Monday. Anything else is refused.
- A job every 10 minutes keeps the next 20 dates within 60 days, up to 100 dates in all.
- Booked dates are never moved or deleted. If you change the rule, unbooked dates that no longer fit are
  removed. Clearing the rule keeps the dates already made.

You can also add single dates by hand in the panel.

## Slot schedules

For sessions sold in fixed slots (a class, a studio, a range lane), fill in the panel's **Schedule** fields
instead of a rule: the days (`MO` to `SU`), the start times (`09:00, 10:30`), the minutes per slot, the places
per slot, how many days ahead people can book (1 to 90, default 56) and any closed dates (`2026-12-25`).
Times are local to the entry's time zone. A slot time that does not exist on a clock-change day is skipped;
one that happens twice takes the first.

- A job every 10 minutes keeps every slot inside the book-ahead window, 50 slots a run (a new schedule of
  six slots a day for 90 days is complete in under two hours), at most 600 slots ahead.
- An event has a schedule or a rule, never both, and no dates of its own: remove its dates before adding a
  schedule. Clearing the schedule keeps the slots already made.
- Changing the schedule never moves or deletes a booked slot. Unbooked slots that no longer fit (other days or
  times, a closed date, fewer days ahead) leave sale at once and are deleted about ten minutes later. New places
  and lengths apply to slots made afterwards; change an existing slot in the day view.
- **Show day** opens one day's slots: switch a slot off to close it, switch it on to reopen it, change its places,
  or close or reopen the whole day. The schedule keeps these changes. A slot with seats held or sold cannot be
  closed: the panel lists its bookings instead. One save changes up to five slots; save again for the rest.
- The booking form shows a month calendar of the days that have slots; choosing a day lists its times with the
  places left (full slots are shown as full and cannot be chosen, closed ones are not shown). **Earlier dates** and
  **Later dates** page through the months. Without JavaScript the same month's times are a list grouped by day.
  Any event with two or more dates on one day gets the same picker. Ticket types, the event capacity and the
  waitlist work as for any dated event.

## Emails

Events sends confirmation, cancellation and waitlist-offer emails (Pro adds reminders, updates and refund
notices). Each is rendered when it is sent, from current data, so it shows the latest title and time.

The plugin sends at most two emails a minute ([Configure](configure.md#email)). A burst of 60 bookings takes
about half an hour to email. Emails, calendar files and the admin are in English
([Translations](translations.md)).

## Admin pages

- **Bookings**: search by status, reference or email. **Delete personal data** erases one booking (by
  reference) or every booking of one buyer (by email), with their attendees and waitlist entries.
- **Attendees**: pick an event, search by name, email or check-in code, check people in or undo it, and
  **Download CSV**. The CSV holds 100 attendees per download (the page you are on); the columns are name,
  email, code, ticket type, booking, booking status, attendee status and check-in time. Cells that would run
  as a spreadsheet formula get a leading apostrophe.
- **Event editor**: the panel's settings for any collection (see above).
- **Setup check**: links to the setup check on your site, `/_events/setup`, and to the plugin settings. The
  check (for administrators signed in to the admin) shows the field mapping and whether the collection and
  fields exist, whether saved secrets can be decrypted with `EMDASH_ENCRYPTION_KEY`, and whether Turnstile is
  set up. It shows no secret values. It runs on the site so the plugin itself stays small.
- **Ticket sales** dashboard widget: sold and held against capacity.

## Check-in

On every edition, staff check people in on the **Attendees** page, by name or by the code on the pass. The
page shows who is checked in and when, and **Undo** reverses a mistake.

Events Pro adds QR codes to the passes and a phone-friendly check-in screen at `/_events/check-in`. Staff open
it while signed in to the EmDash admin, so EmDash decides who may check people in. Where the browser has a
`BarcodeDetector` (Chrome on Android, for example) it uses the camera. Elsewhere, such as Safari on iPhone,
staff type the code. The screen needs JavaScript. The QR code is made by the site's own plugin, so no outside
QR service sees a ticket code. On Free the screen says it needs Events Pro.

## Deleting and unpublishing events

EmDash will not move an event with live bookings to the bin: the plugin vetoes it. Unpublishing an event
takes it off sale and out of the public listings until you publish it again. If an entry is deleted
permanently anyway, its bookings stay and the event is marked orphaned.

Event pages get schema.org `Event` data (JSON-LD) with one offer per visible ticket type, for search engines.

## Pro features

These need Events Pro ([Free and Pro](editions.md)). The Free UI already contains their parts, so nothing
changes on your pages when you upgrade.

### Paid tickets

Stripe Checkout, refunds and late payments. See [Paid tickets](payments.md).

### Promo codes and hidden tickets

The booking form shows a **Promo code** field when the event has codes. A code gives a discount or unlocks
hidden ticket types. Codes have usage limits and validity windows. An applied code is kept in a cookie for 30
minutes and never put in a URL.

### Custom attendee questions

Add up to 20 questions per event in the panel: free text (up to 500 characters), a choice of up to 20
options, or a checkbox. Each can be required.

Questions are answered once per booking, by the buyer, on the booking form. The answers appear in the
attendee CSV export, one column per question, repeated on every attendee row of the booking. They are not
shown on the booking page, in emails or on waitlist-offer bookings (an offer is made without the form, so it
has no answers). Answers per attendee would need the form to collect each attendee, which it does not yet.

### Reminders, updates and opt-out

- **Reminders**: set **reminderHours** (default 24; up to three offsets, such as 72 and 24). Each confirmed
  booking gets one reminder per offset before its event or date.
- **Broadcasts**: the **Email attendees** page sends your message to everyone booked on an event or date: the
  buyer and each attendee's own address, without duplicates, at most 10 addresses per booking.
- Both are sent through the same outbox, so at two emails a minute: a broadcast to 500 people takes about
  four hours to deliver, and confirmations queued meanwhile wait behind it.
- Every reminder and update has an opt-out link to `/_events/opt-out`. Opening the page changes nothing; the
  person presses a button to stop reminders and updates for that booking. Cancellation notices are always
  sent. An opt-out link stops working once the buyer opens a newer booking link; the next email carries a
  fresh one.

### Sales reports

A 30-day sales chart and revenue by ticket type.

### MCP tools

Seven tools for AI assistants connected to EmDash over MCP: `listEvents`, `getAvailability`, `findBooking`,
`cancelBooking`, `listAttendees`, `checkInAttendee` and `refundBooking`. EmDash lists them only after an
admin enables the plugin's tools. They act with an admin's rights. `cancelBooking` and `refundBooking` are
marked destructive. An admin can cancel until the event starts (the buyer's cutoff does not apply); a paid
booking is refunded in full first. Answers never include ticket check-in codes.

Most tools stay well inside the platform's limit of 10 storage and network calls per request. Cancelling a
paid booking (10 calls) and `refundBooking` (9) use the same path as the booking page and the Bookings page,
so they run at the limit by design. If one fails part-way, the seat counters are repaired by the next
sweep.
