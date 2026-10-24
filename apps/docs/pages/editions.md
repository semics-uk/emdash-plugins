# Free and Pro

**Free** is MIT licensed, on the plugin registry and npm, and complete for the common case: a free or RSVP
event, and a one-signer agreement. **Pro** adds what organisations pay for: taking money, running large events
with staff, and multi-party or high-volume signing.

Some things are never Pro: security, privacy, legal evidence and getting your data out. Consent capture, the
audit trail, retention and deletion, CSV export and the public API stay free.

## Events

| Feature | Free | Pro |
| --- | --- | --- |
| Events from your own collection, ticket types, capacity, holds | Yes | Yes |
| Free tickets and RSVP, booking page, confirmation email, calendar files, search-engine data | Yes | Yes |
| Recurring events | Yes | Yes |
| Waitlist with offers | Yes | Yes |
| Self-service cancellation | Yes | Yes |
| Attendee list, CSV export, check-in from the admin by name or code | Yes | Yes |
| Ticket sales dashboard widget | Yes | Yes |
| Public JSON routes and the UI components | Yes | Yes |
| Paid tickets: Stripe Checkout, refunds, late payments ([Paid tickets](payments.md)) | | Yes |
| Promo codes and hidden tickets | | Yes |
| Custom attendee questions, with answers in the export | | Yes |
| Required waivers through E-sign ([Waivers](waivers.md)) | | Yes |
| QR ticket passes and the phone check-in screen | | Yes |
| Scheduled reminders and broadcast emails | | Yes |
| Sales reports: a 30-day chart, revenue by ticket type | | Yes |
| MCP tools | | Yes |

## E-sign

| Feature | Free | Pro |
| --- | --- | --- |
| Markdown templates with placeholders, versions | Yes | Yes |
| One signer per envelope, typed name with an optional drawn signature | Yes | Yes |
| Consent capture, hash-chained audit trail, signed PDF with certificate | Yes | Yes |
| The `/verify` page | Yes | Yes |
| Retention settings and deletion on request | Yes | Yes |
| Signer can decline, sender can void | Yes | Yes |
| Envelopes expire after a set number of days | Yes | Yes |
| The signing protocol and integration clients | Yes | Yes |
| Several signers, in parallel or in turn | | Yes |
| Email one-time code before signing | | Yes |
| Automatic reminders | | Yes |
| Uploaded PDF templates | | Yes |
| Self-serve signing forms on your pages | | Yes |
| Bulk send from a CSV | | Yes |
| MCP tools | | Yes |

The suite stays free. The waivers it runs are an Events Pro feature; the E-sign side of the protocol stays
free, so any other system can integrate with E-sign.

## How Pro works

- **Same plugin, two builds.** Pro is the Free plugin built with more features, under the same slug and
  publisher. It reads the same data. Moving from Free to Pro, or back, keeps everything. Going back switches
  Pro features off; it never deletes data.
- **Delivery.** Pro comes as a public npm package under a commercial licence: anyone can install it, and
  the licence key is what unlocks it. You put it in `sandboxed` where the Free core was
  ([Install](install.md#pro-builds)).
- **Licence key.** A key bound to your site's hostnames, pasted into the plugin's **Licence key (Pro)**
  setting. The plugin checks it offline: no call home, no extra outside host. Local and preview hosts
  (`localhost`, `*.workers.dev`, `*.pages.dev`) need no key.
- **Without a valid key**, Pro features stop taking new work (no new paid checkouts, for example), but work in
  progress carries on: refunds, signatures already started and reports stay available.
- **Updates.** A key includes a year of updates and support. Versions released during that year keep working
  after it ends.
