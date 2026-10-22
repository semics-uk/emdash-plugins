# @semics-tech/emdash-events-suite

Links [semics Events](../events) and [semics E-sign](../esign) on one EmDash site: one config call,
and `<BookingWithWaiver>`, a booking form whose waivers are signed inline, on the same visit.

The suite adds no plugin code of its own: no capabilities, storage or routes. It wires the two products
together through their public routes. Waivers are an Events Pro feature; with the Free Events core
the same form makes a plain booking.

## Install

```js
// astro.config.mjs
import { eventsSuite } from "@semics-tech/emdash-events-suite";

const suite = eventsSuite();

export default defineConfig({
	integrations: [
		...suite.integrations,
		emdash({
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			sandboxed: suite.sandboxed,
			plugins: suite.plugins,
		}),
	],
});
```

`eventsSuite()` returns both sandboxed cores, both UI descriptors, and the Astro integrations of both
products plus the suite's waiver page (`/_events/waiver`). Each part gets the plugin id of each core it
calls, so nothing assumes a slug:

```js
eventsSuite({ events: eventsPro() });                         // a Pro build instead of the Free core
eventsSuite({ events: { pluginId: "r_…" }, esign: { pluginId: "r_…" } }); // cores installed from the registry
```

Pair the two cores in the admin: create an integration client in E-sign (Integrations), paste its
pairing string into the Events settings, and allow `https://<your site>/booking` as a return URL.

## Book with a waiver

```astro
---
import BookingWithWaiver from "@semics-tech/emdash-events-suite/astro/BookingWithWaiver.astro";
---
<BookingWithWaiver event={entry.id} />
```

The form lists the buyer and one row per attendee, each with an "under 18" control (`seats`, default
4, at most 10). Names and emails with control characters are refused before anything is booked.
It posts to `/_events/waiver`, which reserves the seats and passes the attendees on. When the event
requires a waiver (Events Pro), each signing intent is redeemed with E-sign: the buyer signs inline,
for themselves and as guardian for every attendee under 18, one ceremony after another on that page;
other adults are emailed their own waiver. Each receipt is forwarded to Events as the ceremony ends,
and the buyer lands on `/booking`, confirmed. It works without JavaScript.

`/_events/waiver` sends E-sign's ceremony Content-Security-Policy, `Referrer-Policy: no-referrer` and
`no-store`. Signing tokens never appear in a URL: they are kept in an HttpOnly, SameSite=Strict cookie
scoped to that page.

Paid waiver events (Phase 4): when continue answers with a payment step, the browser goes to the
provider's checkout.
