# Pages and components

The UI kits add a few pages to your site, give you Astro components for your own pages, and register blocks
for EmDash's rich-text editor. Every word they show comes from a translation table
([Translations](translations.md)).

## Pages the plugins add

The Astro integrations add these routes. Do not create pages of your own at the same paths.

| Route | From | What it is |
| --- | --- | --- |
| `/booking` | Events | The buyer's booking: status, passes, calendar link, cancel. Also the return page after payment and waivers |
| `/_events/checkout` | Events | Where the booking form posts (no JavaScript needed) |
| `/_events/promo` | Events | Where the promo code button posts (Pro codes) |
| `/_events/waitlist` | Events | Where the "Join the waitlist" form posts |
| `/_events/sign` | Events | Door signing of a waiver at check-in (Pro) |
| `/_events/check-in` | Events | The staff check-in screen (Pro; Free says it needs Pro) |
| `/_events/opt-out` | Events | Stop reminder and update emails for one booking (Pro) |
| `/sign/[token]` | E-sign | The signing page linked from the invitation email |
| `/signed/[token]` | E-sign | The signer's copy, linked from the completion email |
| `/verify` | E-sign | Check a signed PDF |
| `/_esign/start` | E-sign | Where the self-serve signing form posts (Pro) |
| `/_events/waiver` | Suite | Books and signs waivers inline |
| `/_events/templates` | Suite | Refreshes the panel's list of waiver templates (Pro) |

All of them are rendered on the server. Every page sends `Referrer-Policy: no-referrer` and
`Cache-Control: no-store`, and every route that takes a form post refuses posts from other sites.

## Events components

Import them from `@semics-tech/emdash-events/astro/<Name>.astro`.

| Component | Props | Use |
| --- | --- | --- |
| `BookingWidget` | `event` (entry id), `heading`, `locale` | The booking form, waitlist form and promo field |
| `EventList` | `heading`, `limit`, `locale`, `hrefFor` | Upcoming events on sale, as cards |
| `EventCard` | `event`, `href`, `locale`, `headingLevel` | One card |
| `BookingStatus`, `TicketPass`, `AddToCalendar`, `PaymentReturn` | | Parts of `/booking`, for your own booking page |

An event page with a booking form:

```astro
---
import { getEmDashEntry } from "emdash";
import BookingWidget from "@semics-tech/emdash-events/astro/BookingWidget.astro";

const { entry } = await getEmDashEntry("events", Astro.params.slug ?? "");
if (!entry) return new Response(null, { status: 404 });
---
<h1>{entry.data.title}</h1>
<BookingWidget event={entry.data.id} heading="Book tickets" />
```

`event` is the entry's id (`entry.data.id`), not its slug. For a slot schedule (or several dates a day) the
form picks a day, then a time; it pages by month with the `booking_from` query parameter (`YYYY-MM-DD`), so keep
the page's query string when you link to it. A list of events:

```astro
---
import EventList from "@semics-tech/emdash-events/astro/EventList.astro";
---
<EventList heading="What's on" limit={6} />
```

Cards link to `/events/<slug>` unless you pass `hrefFor`.

## Editor blocks

- **Book an event** (`events-booking`): a booking form for one event, by entry id or slug.
- **Events list** (`events-list`): upcoming events, with a heading and a number (1-20).
- **Self-serve signing form** (`esign-request`, E-sign Pro): a form that emails a visitor a signing link.

## E-sign components

The signing, signed-copy and verify pages are complete pages; most sites need nothing more. The pieces are
exported from `@semics-tech/emdash-esign/astro` for sites that build their own pages.

## Styling

The components ship small, plain styles that follow the page's colours. They use logical properties only, so
they mirror in right-to-left languages, and they work at 320 px wide ([Accessibility](accessibility.md)).

To match your design, set these custom properties on any element around the components (for example
`:root`). They are the only styling the kits promise to keep across upgrades; anything else in their CSS can
change in a minor release. The defaults meet WCAG AA contrast with each other; keep that when you change them.

| Events property | E-sign property | Used for | Default |
| --- | --- | --- | --- |
| `--events-fg` | `--esign-fg` | Text | `#1a1a1a` |
| `--events-muted` | `--esign-muted` | Secondary text | `#4a4a4a` |
| `--events-bg` | `--esign-bg` | Backgrounds of fields and panels | `#ffffff` |
| `--events-border` | `--esign-border` | Borders of fields and panels | `#6b6b6b` |
| `--events-accent` | `--esign-accent` | Buttons and links | `#0b57d0` |
| `--events-accent-fg` | `--esign-accent-fg` | Text on the accent colour | `#ffffff` |
| `--events-error` | `--esign-error` | Error messages and invalid fields | `#b3261e` |
| `--events-success` | | Confirmations | `#146c2e` |
| `--events-radius` | `--esign-radius` | Corner radius | `6px` |
| `--events-font` | | Font family | `system-ui, sans-serif` |
| | `--esign-paper` | The document being signed | `#fafafa` |
