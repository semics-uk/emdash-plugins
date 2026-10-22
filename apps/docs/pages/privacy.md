# Data and retention

Both plugins keep their data in your EmDash site's own database. Neither sends personal data to us. The only
outside services are the ones you set up: your email provider, Cloudflare Turnstile if you add its keys, and
Stripe for Events Pro paid tickets.

You are the controller of this data. The defaults below are a starting point, not legal advice. A brief for
your lawyer, describing exactly what E-sign records, is in
[docs/legal/brief.md](../../../docs/legal/brief.md).

## Events

**What is stored**: for each booking, the buyer's name and email, each attendee's name and email, ticket
choices, totals, any answers to questions (Pro), and a hash of the buyer's IP address for the booking limit.
Waitlist entries hold a name and an email.

**Retention** (setting **Keep booking data (days)**, default 365, at least 30). A job runs every hour:

- An hour after a booking, it clears the IP hash (the booking limit only looks back 10 minutes).
- Once an event ended longer ago than the period, it erases the personal data of its bookings and attendees:
  names, emails, answers. Seat counts, totals, ticket lines and statuses stay, so your sales figures stay
  right.
- It deletes sent and failed emails in the outbox older than the period (they hold the recipient's address).
- It deletes waitlist entries that joined longer ago than the period.

A booking that is still live (held, awaiting signature or payment, or confirmed for an event still to come)
is never erased.

The IP hashes use a salt that is a site secret: the Turnstile secret, or a random value the plugin makes on
its first booking. The rate-limit counters (keyed by a hashed IP address) are deleted by the same retention
pass once their window has ended, in both plugins.

**Pro exports**: a full attendee export (names, emails and answers) that Events Pro stores for download
expires 24 hours after its last step. It stops downloading then and is deleted soon after; starting a new
export deletes the previous one.

**Deletion on request**: on the **Bookings** page, **Delete personal data** takes a booking reference or a
buyer's email. It lists what it found, and on confirmation erases those bookings, their attendees and the
person's waitlist entries straight away. Live bookings are left alone.

## E-sign

Settings: **Keep personal data (months)**, default 12, and **Keep signed records (years)**, default 7. The
first is never longer than the second. Both count from when an envelope closed (completed, declined, voided
or expired; a draft from its last edit). A daily job then does this:

1. **After the personal-data period**, it deletes the signer's name, email, IP address, browser, typed name
   and drawn strokes, the values they entered, any decline reason and their links. It deletes the envelope's
   prefilled values and return URL, and the audit trail's raw personal values together with the salt that
   could prove them. Drafts are deleted. The audit trail itself still verifies.
2. **Until the signed-records period ends**, it keeps the **signed record**: the signed PDF, the frozen
   document and the audit trail. The signed record still shows what was signed, so personal data stays inside
   it for this period:
   - the certificate prints the signer's name and IP address, and the participant's name (the minor's name,
     when a guardian signed for a minor);
   - the signed PDF keeps the values the signer entered, under "Details entered by the signer";
   - the document may contain the signer's name or email (`{{signer.name}}`, `{{signer.email}}`) and any
     personal data written into the template or its values.

   So the signer's name and IP address stay in the system until the signed-records period ends, inside the
   signed PDF and its certificate, even though the separate copies are deleted after 12 months. `/verify`
   keeps matching the PDF during this period.
3. **After the signed-records period**, it deletes the PDF, the document, the audit trail and the signer
   record. A small tombstone stays (status, dates and hashes, with no title and no personal data) so the
   numbering of later records stays intact. `/verify` no longer recognises the PDF and says that old records
   are deleted.

Envelopes still out for signature are never purged. An unsigned one expires **Envelope expiry** days after it
was sent (an hourly job closes it, so retention can then age it out); you can also void it.

**Deletion on request**: on the **Envelopes** page, **Delete personal data** takes a signer's email or an
envelope id. It removes the personal data straight away, whatever the period, but keeps the signed record for
its own period. It skips envelopes still open, and a completed one whose PDF is not made yet. There is no
self-service form for signers and no export tool for access requests: handle those by hand.

Used one-time values of the signing protocol are swept every hour.

## IP addresses

Both plugins see the visitor's IP address only through EmDash, and only as reliably as your proxy setup
allows. Read [Client IP addresses and proxies](configure.md#client-ip-addresses-and-proxies) before you rely on
the IP address in a signing record.
