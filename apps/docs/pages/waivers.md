# Waivers (Events and E-sign together)

An event can require every attendee to sign a waiver before they get in. This joins three parts:

- **Events Pro** decides that an event needs a waiver and holds the booking until it is signed. Required
  waivers are a Pro feature. With the Free Events core, the same booking form makes a plain booking.
- **E-sign** (Free is enough) runs the signing and keeps the evidence.
- **The suite** (`@semics-tech/emdash-events-suite`) wires them together and adds the booking form that
  signs inline.

## Set up

1. Install with the suite ([Install](install.md#events-and-e-sign-together)).
2. In E-sign, write the waiver template and mark it **available to integrations**. Use
   `{{participant.name}}` for the person a guardian signs for.
3. In E-sign **Integrations**, create a client whose return URL is `https://<your site>/booking`, and copy
   its pairing string ([E-sign guide](esign.md#integrations)).
4. In the Events settings, paste it into **E-sign pairing string**.
5. In the event's **Tickets & booking** panel, turn on **Require a signed waiver**, pick the template, and
   choose **Who signs**:
   - **Each attendee** (default): the buyer signs for themselves and for every attendee under 18. Every other
     adult is emailed their own waiver.
   - **The buyer, once per booking**: one signature covers the booking.

   **Refresh templates** in the panel fetches the list of templates from E-sign (through the suite's
   `/_events/templates` page).

## Put the form on the event page

```astro
---
import { getEmDashEntry } from "emdash";
import BookingWithWaiver from "@semics-tech/emdash-events-suite/astro/BookingWithWaiver.astro";

const { entry } = await getEmDashEntry("events", Astro.params.slug ?? "");
---
{entry && <BookingWithWaiver event={entry.data.id} seats={4} />}
```

The form lists the buyer and one row per attendee, each with an "under 18" box. `seats` sets the number of
rows (default 4, at most 10). For an event without a waiver it shows a plain ticket choice instead. It works
without JavaScript.

## What happens

1. The form posts to `/_events/waiver`, which holds the seats and passes the attendees to Events.
2. The buyer signs on that page, one ceremony after another: for themselves, then as guardian for each
   minor. Each signature is passed back to Events as it is made.
3. Other adults are emailed their own signing link. An invitation goes only to the address the buyer typed
   for that seat, and to at most 10 adults per booking.
4. When every inline signature is in, the booking is confirmed (a paid event goes on to Stripe first) and the
   buyer lands on `/booking`.

An attendee whose waiver is still unsigned cannot be checked in. The check-in screen and the Attendees page
show a door signing link (`/_events/sign`) so they can sign on the spot. If the buyer's return page never
ran, opening `/booking` again catches up with the signatures E-sign already holds.

If E-sign cannot start a signature, the waiver page shows a **Try again** button; the seats stay held.

## The attendee list on the booking page

With Events Pro, `/booking` lists every attendee of a waiver booking as **Signed** or **Waiting**:

- **Sign now on this device** opens that attendee's signing right there, for a shared phone or a front-desk
  tablet. An adult signs for themselves; an attendee under 18 is signed by the buyer as guardian.
- **Resend invitation** (adults invited by email) emails their signing link again, with a fresh link. Each
  attendee can be sent it again up to 3 times, at most once every 10 minutes.
- **Change attendee details** corrects the names and emails of attendees who have not signed, until
  `attendeeEditCutoffHours` (Events Pro setting, default 24) before the event or date starts. The number of
  seats cannot change, a signed attendee cannot be changed, and each attendee can be changed up to 3 times.
  When an invited adult's details change, their old signing request is withdrawn and the corrected person
  gets a new one.

Every button works without JavaScript. Staff check-in and the door signing link stay as the backstop.

## Security

- Signing tokens never appear in a URL. They are kept in an HttpOnly, SameSite=Strict cookie limited to the
  waiver page.
- `/_events/waiver` sends E-sign's ceremony Content-Security-Policy, `Referrer-Policy: no-referrer` and
  `Cache-Control: no-store`.
- Names and emails with control characters are refused before anything is booked.
- Once invitations are out, the attendees of a booking can only be changed from the booking page's
  attendee list, before the cutoff, and never once they have signed. A resent invitation goes to the same
  person; a changed one first withdraws the old request. Still at most 10 adults per booking are emailed.

## Limits

- The suite's own pages (`<BookingWithWaiver>`, `/_events/waiver`, `/_events/templates`) are English only for
  now ([Translations](translations.md)).
- Back on the Free Events core, waivers are not enforced: attendees with an unsigned waiver can be checked
  in. The data stays, and Pro enforces them again after an upgrade.
