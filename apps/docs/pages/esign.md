# E-sign guide

semics E-sign collects **simple electronic signatures** (ESIGN and UETA in the US, a simple electronic
signature under eIDAS in the UK and EU). It is not an advanced or qualified signature service. Whether a
simple signature is enough for your documents is a question for your lawyer.

## Templates

A template is a Markdown document with placeholders in double braces:

- `{{venue}}`, `{{company}}` and so on: values you fill in when you create an envelope.
- `{{signer.name}}` and `{{signer.email}}`: the signer's details.
- `{{participant.name}}`: the person signed for, when a guardian signs for a minor (waivers).

Saving a template makes a new version; sent envelopes keep the version they were sent with. A template marked
**available to integrations** can be used by other systems through the signing protocol (Events waivers use
this). It is off by default.

Limits: a template body of 100,000 characters; an envelope takes up to 32 filled-in values of up to 500
characters each.

## Envelopes

An envelope is one document sent to one signer (Free). On the **Envelopes** page:

1. Pick a template, fill in its placeholders and the signer's name and email.
2. Optionally ask the signer to fill in fields of their own, such as a phone number (up to 16).
3. **Send**. The text is frozen and hashed at this moment, and the signer is emailed a link to
   `/sign/<token>`.

You can **Resend** an invitation (with a fresh link) or **Void** an envelope. An unsigned envelope closes by
itself **Envelope expiry** days after it was sent (default 30); a job checks every hour.

Sending needs the site URL ([Configure](configure.md#the-sites-public-address)). Without it nothing is
emailed and the page says so.

## Signing

The signer opens the link and reads the document (the exact text being signed is one click away). They fill in
any fields asked of them, type their full name, may also draw a signature, and agree to the consent wording.
They can also **Decline**, with a reason.

- The link is the credential. It is long and random, and the site stores only its hash. The page sends
  `Referrer-Policy: no-referrer` and posts the token rather than putting it in later URLs.
- Opening the page records nothing. The first view is recorded when the signer presses sign or decline, so a
  mail scanner that opens the link does not count as the signer.
- 20 wrong links from one IP address in 10 minutes block that address for a while. There is no Turnstile
  on this page.
- The signing page works without JavaScript; the drawing pad needs it.

When the signer signs, the plugin builds the signed PDF once: the document, the signature, the values the
signer entered (under "Details entered by the signer"), and a certificate listing every audit event. The
signer gets a completion email with a link to `/signed/<token>`, where they can download their copy. Download
links last 15 minutes and are made fresh on each visit.

## The audit trail

Every step (created, sent, viewed, consented, signed, declined, voided, expired) is an audit event. Each
event's hash covers the one before it, so changing or removing an event breaks the chain. Personal values
(name, email, IP address, browser) enter the chain only as salted hashes. That lets the retention job delete
them later without breaking the chain. See [Data and retention](privacy.md).

## Verify a signed PDF

`/verify` lets anyone check a PDF. They choose or drop the file; the browser hashes it and sends only the
hash. The page says whether it matches a document signed on this site, and whether the audit chain verifies.
It allows 20 checks per IP address in 10 minutes. Once a record's signed-records period has ended, `/verify`
no longer recognises its PDF.

## Integrations

Other systems (such as Events, for waivers) ask E-sign to start a signature with a signed "intent". The
protocol is [esign-intent/1](../../../docs/protocol/esign-intent-v1.md).

On the **Integrations** page:

1. **Generate** the integration master key (once; the site needs `EMDASH_ENCRYPTION_KEY`). Changing it later
   breaks every pairing.
2. **Create client**: a name, and the return URLs allowed for it, one per line (at most 10; `https` only,
   `http` only for `localhost`). For Events waivers this is `https://<your site>/booking`.
3. Copy the **pairing string**. It is shown only in that one answer. Paste it into the other system
   (for Events: the **E-sign pairing string** setting).

**Revoke** stops a client at once. A site can have up to 100 clients.

## Pro features

These need E-sign Pro ([Free and Pro](editions.md)). The Free edition keeps such envelopes safe after a
downgrade: it never completes a half-signed or unverified one.

### Several signers

2 to 10 signers per envelope, signing in parallel or in turn. Each gets their own link; the envelope
completes when the last one signs, and everyone gets the signed copy. Templates can use `{{signer1.name}}`,
`{{signer2.name}}` and so on.

### Email one-time code

The signer must enter a six-digit code sent to their email before signing. On by default for contract
templates (templates not offered to integrations), and optional for others. The certificate records the
check.

### Automatic reminders

A pending signer is reminded every **Reminder cadence** days (at most 5 times, never after expiry).

### Uploaded PDF templates

Upload a PDF from the media library instead of writing Markdown, and place the signature, name, date and
text fields on its pages.

- At most **3 MiB** and **500 pages**. Encrypted files, files with JavaScript or other active content, and
  unusual compression are refused, each with its own message.
- The signer gets links to open or download the PDF, not an embedded viewer.
- The signed copy is the original file with the stamps and the certificate added as an update, so the
  original bytes stay unchanged inside it.
- In 1.0 a PDF template has one signer and is sent from the admin. Integrations (such as Events waivers),
  self-serve forms, bulk send and the MCP tools use Markdown templates.
- Every uploaded version of a PDF template is kept, because envelopes signed on it point to it.

### Self-serve signing forms

The **Self-serve signing form** block lets a visitor request a template themselves. The visitor types a name
and email; the signing link is emailed, never shown, so the signer must control that inbox. Turnstile is
required (the form stays hidden without the keys). Limits: 5 requests per address in 10 minutes and a daily
cap per template (default 50, up to 1,000). On Free the block shows that the form is not available.

### Bulk send

Paste a CSV (up to 500 rows: name, email and one column per placeholder) and send one envelope to each row.
Nothing is sent unless every row is valid; problems are listed by line and column.

### MCP tools

Five tools for AI assistants connected to EmDash over MCP: `listTemplates`, `sendForSignature`,
`getEnvelopeStatus`, `remindSigners` and `voidEnvelope` (marked destructive). EmDash lists them only after an
admin enables the plugin's tools. They can do what an admin can.
