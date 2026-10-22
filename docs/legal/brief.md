# E-sign: brief for legal review of consent, evidence and retention

Issue 1. Prepared from the code of `packages/esign` (the E-sign plugin) and the Events integration protocol as they stand
in this repository. Numbers in square brackets, such as [C3], point to the code list at the end. Where a project document
and the code disagree, this brief follows the code and says so (section 12).

## 1. What this brief is for

We ask you to review the consent wording, the evidence the product records, and the retention and deletion behaviour, for
use by site owners in the United Kingdom, the European Union and the United States. Section 13 lists the questions we
most need answered. The product has not had a legal review before; the build plan requires one before version 1.0.

## 2. What the product is, and is not

**What it is.** E-sign is a plugin for the EmDash content management system. A site owner installs it on their own site. It
lets a person read a document and sign it on a web page, then produces a signed PDF with a "certificate of completion"
and keeps a tamper-evident record of how the signature was made. The Events plugin (a booking plugin by the same
maker) can use E-sign to collect waivers at booking time. [C1]

**What it claims.** A *simple* electronic signature only: under ESIGN and UETA in the US, and a "simple electronic
signature" (SES) under eIDAS in the UK/EU. The certificate says this in its own words: the signer "consented to sign
electronically, confirmed their intent to sign, and signed the exact text identified by the document SHA-256". [C2]

**What it does not claim or do.**

- It is not an advanced or qualified electronic signature. It does not claim the legal effect that eIDAS Article 25(2)
  gives only to qualified signatures. There is no certificate-based signing, no trusted timestamp authority and no
  third-party identity check. [C2]
- It does not verify who the signer is beyond control of an email inbox (section 6).
- It does not decide whether a given document may lawfully be signed electronically (for example documents excluded by
  ESIGN section 7003, or certain consumer, property or family-law documents). That is the site owner's decision.
- It does not give the site owner legal advice, or choose the text of the documents or the consent wording on their
  behalf. The default consent wording is a starting point (section 4).
- It does not currently show the consumer-consent disclosures that ESIGN section 7001(c) requires before electronic
  records replace paper ones for consumers (right to paper, withdrawal, hardware and software requirements). See question 2.

**Who is who.** The site owner (the business running the EmDash site) decides why and how signatures are collected, so
will normally be the data controller. The maker of the plugin does not receive signing data: it stays in the site
owner's own EmDash database. We have not drafted any contract between the maker and site owners; see question 12.

**Editions.** The Free edition has one signer per document, typed or drawn signatures, the consent record, the audit
trail, the signed PDF and certificate, `/verify`, retention and deletion on request. The Pro edition adds several
signers, an email one-time code (not built yet, section 6), automatic reminders, PDF templates and the Events waiver
flow. [C1]

## 3. The signing ceremony, step by step

1. **Document frozen.** When the sender sends an envelope, the document text (Markdown rendered from a template plus
   values) is frozen as a "snapshot". Its SHA-256 hash is stored as `docSha256`. The snapshot cannot change after that,
   whatever happens to the template. [C3]
2. **Invitation.** For email delivery the signer gets a message with a personal link containing a 256-bit random token.
   Only a hash of the token is stored. The message says who is asking, names the document and says the link is
   personal. The link contains no other credential. [C4]
3. **Page opens.** The signer sees the document, "Signing as <name> (<capacity>)", and an expandable section "Exact
   text you are signing" showing the full source text and its SHA-256 fingerprint. [C5]
4. **First view recorded.** The `signer.viewed` event is written only when the signer first submits the page (sign or
   decline), not when the page is merely fetched. This is deliberate: mail scanners prefetch links, so a plain page
   load is not evidence that a person opened the document. If the signer only reads and leaves, no view is recorded.
   [C6]
5. **Signer's inputs.** The signer must type their full name. They may also draw a signature with a pointer. Any extra
   fields the sender asked for (for example an emergency contact) are filled in on the same page. [C5]
6. **Two separate tick boxes, both required:**
   - Consent: the configured consent wording. Default: "I agree to use electronic records and an electronic signature
     for this document." [C7]
   - Intent: "I intend the signature above to be my signature on this document." This text is fixed in the page code
     and is not configurable, versioned or hashed. [C5]
7. **Submit.** The button says "Sign document". The server accepts the submission only if both consent and intent are
   literally `true`, the document hash the signer saw still matches, and the consent-wording hash the signer saw still
   matches the configured wording. If the owner changed the wording after the page loaded, the signer is shown the new
   wording and must confirm again (`CONSENT_CHANGED`). [C8]
8. **Decline.** Beside the signing form is a separate "Decline" button with an optional reason (up to 500 characters). A
   decline is recorded and the envelope closes. [C9]
9. **Completion.** The server writes three audit events (`signer.consented`, `signer.signed`, `envelope.completed`),
   closes the envelope as completed and schedules generation of the signed PDF. Once the PDF exists, a completion email gives the
   signer a link to the signed copy. [C8][C10]

No JavaScript is needed to sign; the page works with plain form posts. Cross-site form posts to the signing page are
refused. [C5][C11]

## 4. Consent wording, versions and hashing

- The wording is a site setting (`consentWording`) with a version label (`consentVersion`, default "1"). The default
  wording is the one quoted above. [C7]
- **Change since the T034 review.** The earlier default said the electronic signature had the effect of a handwritten
  signature. That claims what eIDAS Article 25(2) reserves for qualified signatures, so it was replaced by the current
  wording. A site that customised the wording keeps its own text; the product does not check what an owner writes. [C7]
- On each signature the server stores the version label and the SHA-256 of the exact wording shown, in the
  `signer.consented` audit event, on the signer record and on the certificate ("Consent version", "Consent wording
  SHA-256"). The hash identifies the text even if the owner edits the wording without changing the version label. [C8][C12]
- **The wording text itself is not stored per signature, nor printed on the certificate.** Only its version and hash are.
  Proving what the text said later relies on the owner keeping their own copy of each wording that was live (or the
  default, which is in the product source). See question 3.
- The intent sentence (step 6) is recorded only as the fact `intent: true` in the consent event; its text is not
  versioned or hashed.

## 5. Evidence captured for each signature

### 5.1 What is recorded, and where

| Item | Detail | Where stored |
| --- | --- | --- |
| Document | Frozen text and its SHA-256 (`docSha256`) | `snapshots` collection (chunks); hash on the envelope |
| Signer | Name and email as supplied by the sender; capacity (`self`, `guardian`, `buyer`); for a guardian, the minor's name | `signers` and `envelopes` collections |
| Signature | Typed name and/or drawn strokes (points in a unit square), and a signature hash (below) | `signers` collection; hash also in the audit chain |
| Entered values | Answers to any extra fields | `signers` collection; printed on the signed PDF |
| Consent | Version, wording hash, time | `signers`; `signer.consented` audit event |
| Intent | Boolean `true`, time | `signer.consented` audit event |
| Network data | IP address and browser user-agent string at first submit (views, consent, signature, decline) | `signers`; raw values in audit events |
| Times | Created, sent, viewed, consented, signed, completed (server clock, ISO UTC) | audit events and records |
| Admin actions | Send, resend, void carry the acting admin's user id, not their email | audit events |
| Decline reason | Free text, optional | `signers` only; deliberately kept out of the audit chain |

IP address and user agent come from the request headers as seen by the EmDash host, and are only present if the host
provides them. If it does not, they are simply absent. [C8][C13]

### 5.2 Tamper evidence

- **Audit chain.** Each envelope has an ordered list of events. Each event's hash is
  `SHA-256(previous hash ‖ canonical form of the event)`, starting from 64 zeros. The canonical form covers the version,
  envelope id, sequence number, type, time, actor, non-personal data and the personal-field commitments. Events are
  written with a create-only operation, so two writers cannot fork the chain. [C14]
- **Salted commitments.** Personal fields (name, email, minor's name, IP, user agent) are not hashed raw into the chain.
  Each is hashed together with a random 32-byte per-envelope salt (`SHA-256(salt ‖ value)`); that commitment is part of
  the chain hash and the raw value is stored beside it, outside the hash. Purging the raw values later therefore does
  not break verification. Deleting the salt as well (done by the retention purge, section 9) means a purged value can
  no longer be proved against its commitment, and a low-variety value such as an IP cannot be guessed from it. [C14][C15]
- **Signature hash.** `SHA-256(salt ‖ JSON[document hash, kind, typed name, strokes, entered values])`. This binds the
  signature and the entered values to the exact document. It sits in the chain as `signatureSha256`. [C16]
- **Final hash.** `SHA-256("esign-final/1" ‖ document hash ‖ chain head)`, stored on the envelope and printed on the
  certificate. It ties the document to the end of the trail. [C14]
- **What the check proves, and what it does not.** The chain proves that the events for an envelope are unbroken and
  unedited relative to each other. Truncating or rewriting the whole chain is only caught by comparing with a head
  recorded elsewhere (the certificate or `finalHash`). The product has no external anchor: no trusted timestamp, no
  blockchain, no third-party notary. Anyone with write access to the database and the code could in principle rewrite
  every record consistently; the evidence value rests on the host's access controls. See question 9. [C14]

### 5.3 The signed PDF and certificate

The PDF is built once, when the envelope completes, from the stored snapshot, signature and audit chain. The bytes are
deterministic and stored; downloads return the stored bytes; their SHA-256 is recorded as `pdfSha256`. [C17]

The PDF contains:

1. The document, then the signature (typed name or drawn strokes) with the signer's name and signing time.
2. If the sender asked for extra fields, a table "Details entered by the signer" with each label and the value entered.
3. A page "Certificate of completion" with a fixed paragraph stating this is a simple electronic signature, and a table
   with: envelope id; document title; document SHA-256; **signer name**; signing capacity (Self, Parent or guardian,
   Buyer); **participant name** (the minor, for a guardian signature); signature kind (typed or drawn); signature
   SHA-256; consent version; consent wording SHA-256; signed and completed times; number of audit events.
4. The audit trail: for every event its number, time, type, actor, **IP address** and the first 16 characters of its hash.
5. The audit chain head and the final hash.

The certificate does **not** print the signer's email address or user agent. It does print the IP address of every audit
event that has one (view, consent, signature). The signer's name, the minor's name, the IP addresses and the entered
values are therefore kept inside the PDF, the snapshot and the chain for the whole signed-records period (section 9). The
document text itself may also contain personal data if the owner's template uses the signer's name or email. [C17][C18]

### 5.4 Verification

`/verify` is a public page. A person chooses a PDF; their browser computes its SHA-256 (the file is not uploaded; only the
hash is sent). The server answers whether that hash belongs to a completed envelope, the completion time, the final
hash, and whether the audit chain verifies and ends in the recorded final hash. It never returns names, emails, IPs or
envelope ids. It is rate limited per IP. After the signed-records period ends the record is deleted and any hash
answers "not matched". [C19]

### 5.5 Several signers (Pro)

The Pro edition can send one document to 2 to 10 signers, either in parallel (all are invited at once and may sign in any
order) or in sequence (each signer is invited only after the one before has signed, and a signer cannot sign out of turn).
Everything in sections 3 to 5.4 holds for **each** signer separately:

- each has their own personal link and 256-bit token (only its hash is stored), their own two tick boxes, typed name or
  drawing, entered values, consent version and wording hash, IP address and user agent;
- each signer's events are their own entries in the envelope's one audit chain, marked with the signer's position:
  `signer.invited` (when their link was sent, with their name and email as salted commitments), `signer.viewed` (their
  first submit of the page), `signer.consented` and `signer.signed` (at the time they signed), or `signer.declined`;
- the envelope completes, and `envelope.completed` and the final hash are written, only once every signer has signed. A
  decline by any signer closes the envelope for everyone; a signature given before that stays on the chain as evidence;
- the signed PDF shows every signer's signature and entered values, and the certificate repeats the per-signer facts of
  section 5.3 for each signer in signing order ("Signer 1", "Signer 2", ...); the audit trail names the signer of each
  event ("signer 2"). Every signer gets the completion email with their own signed-copy link.

A signature is written to the signer's record when they submit and to the audit chain by a background job a moment later
(at most about a minute), with the time they signed. Automatic reminders (Pro) email a pending signer every
`reminderCadenceDays` (at most five times, never after expiry) with a fresh link that replaces the earlier one, and each
reminder is a `reminder.sent` audit event. If a site switches back to the Free edition, an envelope with several signers is
left exactly as it is: views and declines are still recorded, but Free refuses to take further signatures, so it cannot
complete with signatures missing. [C34]

### 5.6 Uploaded PDF documents (Pro)

The Pro edition can send an uploaded PDF instead of a text template. Everything in sections 3 to 5.5 holds, with the
PDF file in the place of the text snapshot:

- **The document is the file.** An administrator uploads a PDF from the site's media library and marks where the
  signature, the signer's name, the signing date and any values the signer types go (a box on a page, in points). When
  the envelope is sent, `docSha256` is the SHA-256 of the uploaded file's bytes, exactly as uploaded. The file is stored
  under that hash, so the envelope can only ever point at those bytes, and it cannot change after sending.
- **What the signer sees.** Instead of the text, the signing page names the PDF file (name, number of pages, size), offers
  links to open it in the browser or download it, and shows its SHA-256. The links serve the stored file byte for byte
  (checked against `docSha256` each time) and work only while the envelope can be signed. The PDF is not embedded in
  the page (see below). The signer still types their name, may draw a signature, fills in any fields, ticks both boxes
  and submits; the server checks the document hash the signer was shown, as for text.
- **What is bound.** The signature hash, the consent and signed events and the final hash use `docSha256` (the file's
  hash) exactly as they use the text hash, so the chain binds the signature to that file.
- **The signed PDF.** It is the uploaded file, unchanged, followed by a PDF "incremental update" (a standard way to add to
  a PDF without rewriting it) that draws the signature, name, date and entered values in the boxes the template gives,
  and adds the signature and certificate pages of section 5.3. The certificate's wording says the document is "the exact
  PDF file identified by the document SHA-256" and gives the original file's length: the first that-many bytes of the
  signed PDF are the original file, so anyone can cut the signed copy to that length and check it against
  `docSha256`. `pdfSha256` is the hash of the whole signed file, and `/verify` works as in section 5.4. The bytes are
  deterministic: the same envelope always gives the same file.
- **What the stamps are not.** The positions of the boxes are part of the template, not of the hashed document; the hash
  covers the original file only, and the stamps show the values the chain records. Values the signer entered are also
  listed on the added pages ("Details entered by the signer").
- **Uploads that are refused.** Files over 3 MB, files that are not PDFs or cannot be read, encrypted or
  password-protected PDFs, and PDFs that contain scripts, launch actions or dynamic (XFA) forms are refused at upload
  with a reason.
- **Why links and not an embedded viewer.** EmDash serves every file a plugin returns with a content security policy that
  stops any script in it from running in the site's origin. Browsers' built-in PDF viewers do not run inside such a
  sandboxed frame, and drawing the pages as images on the server is not feasible within the platform's limits, so the
  page offers the file to open or download instead. The signer reads the PDF in their browser's or device's viewer.
- **Retention.** The uploaded file belongs to the template (it is the same for every signer), so it is kept with the
  template and is not removed by the personal-data purge; any personal data the owner puts in the template file is the
  owner's to manage. The signed copy follows the signed-records period like any signed PDF (section 9).
- **Back on Free.** An envelope with an uploaded PDF can still be declined on Free, but Free cannot show or stamp the
  PDF, so it refuses to take the signature; the envelope waits for Pro, as one with several signers does. [C36]

## 6. Identity assurance

- **Free edition: email link only.** The sender enters the signer's name and email. The signer is whoever can open the
  link sent to that address (or, for inline signing, whoever is at the screen when the site owner's flow hands over the
  page). The product records the typed name as entered by that person. It does not check that the typed name is the
  name the sender supplied, that the email belongs to the named person, or that the person is who they say.
  The 256-bit token is the only credential for the signing page; there is no CAPTCHA on the ceremony. [C4][C20]
- **Pro edition: an email one-time code (T091).** This is the only identity step above control of the signing link,
  and it is Pro only (the Free routes `public/otp/send` and `public/otp/verify` are placeholders that return a not-found
  error). When an envelope needs a code, the signer asks for one on the signing page; the site emails a six-digit code to
  the address the sender entered, and the signer must type it before the signature is accepted. The code is random, is
  stored only as a salted hash, expires after 10 minutes, allows 5 wrong tries, can be re-sent after 30 seconds (at most
  5 an hour), and the requests are also limited per visitor address. Each signer of an envelope with several signers
  verifies their own code. A successful check is recorded as an `otp.verified` audit event (method `email`, time, IP and
  user agent; never the code), and the certificate shows "Email one-time code verified" for that signer. What it proves is
  that the person signing could read the inbox of the address the sender gave, at that moment, in addition to holding
  the link. It is not identity verification: it does not show who the person is, that the address belongs to the named
  person, or that the inbox is not shared. Who needs a code: the sender may ask for one per envelope; otherwise the
  "Require email code by default" setting (`otpDefault`, off by default) applies to every new envelope the sender sends,
  and "Require email code for contract templates" (`otpContractTemplates`, on by default) applies to templates that are
  not offered to integrations (waivers started from Events are signed on the owner's site and are not asked for a code
  unless the default is on). The requirement is fixed when the envelope is sent; changing a setting later does not
  change envelopes already sent. A site without a valid Pro licence sends new envelopes without a code. If the site goes
  back to Free, an envelope that needs a code cannot be signed until Pro is back (Free refuses it rather than skip the
  check). The code is emailed straight from the signing request, not through the outbox, and nothing logs it. [C20][C35]
- **Pro edition: public self-serve forms (T093).** A site owner can offer a template on a page (the `esign-request` block). The
  visitor types their own name, email address and any fields the template asks for and passes a Turnstile check. The
  signing link is emailed to the address typed and is never shown on screen or returned by any route, so the visitor
  can sign only if they can open that inbox; typing someone else's address gets them nothing. The signer's identity is
  therefore exactly as in the Free email-link model above (control of the inbox that received the link), and the same
  email one-time code applies as for any contract template (on by default). The name is whatever the visitor typed.
  Protections against misuse are Turnstile, a hidden honeypot field, a limit per visitor address, a daily cap per
  template and a cross-site check on the form post. A third party can still cause one signing-link email to a person
  who did not ask for it (up to the template's daily cap per day); the email says who sent it and nothing is signed
  unless the recipient acts. [C4][C20]
- **Guardian and buyer capacities** are labels chosen by the sender. The product does not check that a person is a
  parent or guardian, or is who the sender says. [C21]
- There is no signer authentication beyond this, no ID document check, and no check against sanctions or age.

## 7. Waivers: minors and adults (Events + E-sign)

Used when a site owner sells event tickets with the Events plugin and requires a waiver. This part is a Pro feature of
Events; the E-sign side that receives it is in this repository, and so is the protocol. [C22]

- **Adults who are present or who book for themselves:** the buyer signs on the page the booking flow opens, for
  themselves (`as: self`). This is an "inline" signature.
- **Minors (under 18, as marked by the buyer):** the buyer signs as parent or guardian (`as: guardian`), with the
  minor's name recorded as `participant`. The certificate prints "Signing as: Parent or guardian" and the minor's name.
  The guardian relationship is the buyer's assertion; nothing checks the age, relationship or parental authority. [C21][C22]
- **Other adults in the booking:** each receives an emailed signing link and signs for themselves (`as: self`, email
  delivery). The protocol forbids one adult signing for another adult. The email goes only to the address the buyer entered
  for that seat; at most 10 emailed adults per booking, and a re-issued request names the same person, so no second
  email is sent. The buyer is the one who supplies other adults' email addresses, which raises its own
  notice question (question 11). [C22][C23]
- **Whole-booking mode:** a second mode has the buyer sign once as `buyer` for the whole group. The brief treats this as
  weaker evidence of each attendee's own agreement and asks whether it should be offered (question 8). [C22]
- **What flows back to Events:** a signed "receipt" containing the envelope id, the booking reference, status, document
  hash, PDF hash, final hash and time. No names, emails or IPs. The PDF itself is not sent to Events. [C24]
- **What Events sends to E-sign:** for each signature, the signer's name and email, the capacity, the minor's name
  (guardian case), the delivery mode, a set of prefilled strings (up to 32 values, each up to 500 characters) and a
  return address on the owner's own site. What the Events waiver step places in the prefilled values is decided by that
  Pro step, which is outside this repository; it may include attendee names. [C22]
- **Check-in:** Events refuses check-in for an attendee whose waiver is pending, and only when the Pro waiver step is
  present. A site that downgrades to Free no longer enforces waivers. [C25]

## 8. Data flows

```
Visitor's browser
   | booking details (names, emails, ticket answers)
   v
Events plugin  --signed intent: name, email, capacity, minor's name, prefill, return URL-->  E-sign plugin
   ^                                                                                           |
   |<--- signed receipt: ids, status, hashes, time (no names/emails/IPs) ---- via browser redirect or in-process lookup
Both plugins run inside the same site, on the owner's own EmDash database. Neither shares storage with the other.
```

- The two plugins exchange short HMAC-signed tokens through the site; they cannot read each other's storage. [C22]
- The signer's name, email, IP and user agent are stored by E-sign. Events stores booking and attendee data separately,
  with its own retention (default 365 days after the event, then names, emails and answers are erased) [C26].
- E-sign sends the signer's name and email in an invitation email via the site's configured email provider, and a
  completion email (a link to the signed copy, not an attachment). [C4]
- Signing links contain a token. The sign page is served with `Referrer-Policy: no-referrer` and posts the token in the
  body. Outgoing email bodies queued for sending hold the clear-text link until the email is sent, then are scrubbed
  (decision R32). [C4][C27]

## 9. Retention, and what survives each stage

Both periods are counted from the moment the envelope closed (completed, declined, voided or expired; for a draft, from
its last edit). An envelope that is still out for signature is never purged; an unsigned one is closed by the hourly
expiry job after `expiryDays` (default 30) after sending, and then ages like any other. A daily job (03:23 UTC) does the
work in small pages. [C28]

| Stage | Default | What is deleted | What remains |
| --- | --- | --- | --- |
| Before the personal-data period ends | 12 months after close | Nothing | Everything in sections 5.1-5.3 |
| **Personal-data purge** (setting `retentionPersonalDataMonths`, 1-120 months; never longer than the signed-records period) | After 12 months | On the signer: name, email, IP, user agent, typed name, drawn strokes, entered values, decline reason, both link-token hashes. On the envelope: the signer block, prefilled values, return URL, the lowercase email index and the per-envelope salt. On every audit event: the raw personal values. Old sent/failed emails in the outbox. Drafts are deleted with their events. | **The signed PDF, the snapshot and the audit chain**, unchanged. They still contain, for as long as the next period lasts: the signer's name and the minor's name on the certificate; every IP address on the certificate; entered values on the PDF; and any personal data written into the document text. Also kept on the signer record: signature kind and hash, consent version and hash, times, capacity. `/verify` still matches the PDF and the chain still verifies. |
| **Signed-records purge** (setting `retentionSignedRecordsYears`, 1-50 years) | After 7 years | The signed PDF chunks, the snapshot, the whole audit chain and the signer record. | A "tombstone" envelope: status, dates, the document hash and final hash, the integration client id and booking reference (these keep numbering and paging consistent), and the personal-data purge marker. No title, no PDF hash. `/verify` returns "not matched". |
| Nonces | Hourly | Used one-time values of the integration protocol, after expiry | Nothing |

[C15][C28][C29]

The requirement behind these periods (decision R45): the signed record is the evidence, so it is kept as a whole for the
signed-records period, including the name and IP it printed. The 12-month purge removes the *separate* copies and the
raw values in the chain, not what is inside the signed PDF. The 12-month figure therefore does not mean the name and IP
are gone from the system at 12 months; they remain inside the signed record until year 7. This needs a lawyer's
view (questions 4 and 5). The README states the same behaviour. [C18][C28]

**Deletion on request.** An administrator can enter a signer's email address or an envelope id on the Envelopes page. The
product lists the matching envelopes (ten at most per request) and, on confirmation, runs the personal-data purge now,
whatever the period, and removes the matching outbox rows. It does not touch the signed PDF, the snapshot or the chain,
which keep their own period. Open envelopes and a completed one whose PDF is not yet made are skipped. There is no
self-service request form for signers, and no export tool for subject-access requests; the site owner would handle both
by hand. [C30]

**Changing the periods.** Both settings are changeable. The brief's defaults came from the build plan (decision D4:
booking data 12 months, signed records 7 years). They are not legal advice. [C31]

## 10. Processors and sub-processors

E-sign itself has no outside service. Which third parties handle data depends on how the site owner configures the site,
so the list below is what *may* apply and should be adapted to the owner's setup.

| Service | Role | Data | Applies when |
| --- | --- | --- | --- |
| Hosting and database (for example Cloudflare Workers and D1, or any host the owner picks for EmDash) | Hosts the site and stores all E-sign records | Everything in section 5 | Always; the owner chooses |
| Email provider (any provider configured in EmDash, through its email capability) | Sends invitation and completion emails | Signer name, email, document title, signing link | Invitation or completion emails |
| Cloudflare Turnstile | Bot check | Request data processed by Cloudflare | Only if the owner sets a Turnstile key; E-sign's own signing ceremony does not use it (the plugin may contact `challenges.cloudflare.com`) |
| Stripe | Payment | Payment details, handled by Stripe | Events Pro only, for paid tickets; E-sign does not send signature data to Stripe |

The maker of the plugin is not a processor of signature data in the design. If the maker also hosts sites, or offers a
licence service that sees site data, that would change this table; we have not set up such a service. [C1][C32]

## 11. Security measures relevant to evidence

Signing tokens are random and stored only as hashes; ceremony failures are rate limited per IP; the sign page and the
verify page are served with a strict content security policy; the PDF and verify routes return no personal data to other
people; the integration tokens are signed with keys derived per client, never stored in clear in the plugin's data.
[C4][C19][C33]

## 12. Where project documents and code disagree

- **The certificate also prints the minor's name.** The retention decision (R45) and the README list "name and IP" as what
  the certificate keeps. The code also prints the participant name (a minor's name in the guardian case) and, on the
  PDF, any entered values. This brief follows the code. [C17]
- **Entered values stay in the signed PDF.** The README says the purge deletes "the values they entered". That is true of
  the stored signer record; the same values remain in the signed PDF's "Details entered by the signer" table until the
  signed-records period ends. [C17][C18]
- **OTP.** The settings screen describes OTP options as "Pro" settings. The Pro build implements them (T091, section 6);
  the Free build only enforces the flag on an envelope that already carries it. [C20][C35]
- **`signer.viewed` on GET.** An earlier question (review T034, task T117) was whether a view should be recorded when a
  mail scanner fetches the page. The code now records a view only on the first submit (sign or decline). [C6]
- The `Free`/`Pro` split is described in the build plan; this brief describes the Free code and treats Pro features as
  described in the protocol and Events notes, not as reviewed code. [C1][C22]

## 13. Open questions for the lawyer

1. **Consent wording for the US.** Is "I agree to use electronic records and an electronic signature for this document."
   enough for ESIGN/UETA where the signer is a consumer? Currently there is no separate consumer disclosure (section 7001(c):
   paper right, withdrawal, hardware/software, scope of consent). Is one needed for waivers, and for which kinds of
   documents?
2. **Consent wording for UK/EU consumers.** Is the wording sufficient to show agreement to sign electronically under
   eIDAS/UK eIDAS and consumer law? Should it say more (for example that the record will be kept, who will keep it, how
   to get a copy)? Should consent and intent be one statement or two, as they are now?
3. **Proving the wording later.** Only the wording's version and hash are stored per signature, not the text. Should the
   text be stored on the signer record or printed on the certificate?
4. **Retention periods.** Are 12 months (personal data) and 7 years (signed record) suitable defaults for a waiver or
   contract in the UK, EU and US? Do limitation periods (England and Wales 6 years for contract; 3 years for personal
   injury, with extended times for minors; EU Member State periods) suggest different defaults for waivers for minors,
   whose limitation periods may start only at 18?
5. **Name and IP kept for 7 years inside the PDF.** Is it defensible under UK/EU data minimisation and storage
   limitation to keep the signer's name and IP in the signed record for the signed-records period, given that the
   separate copies go at 12 months? Or should the product offer a setting to keep the certificate without IP, or to
   redact it, at the first stage?
6. **Certificate contents and data minimisation.** The certificate prints the signer's name, the minor's name (guardian
   case), every IP address, and entered values. Which of these are necessary to prove a simple signature, and which
   should be removed or made optional? Is it right to put a **child's name** on a record kept for 7 years?
7. **IP addresses.** Should IP addresses appear on the certificate at all? They help show who used the link, but are
   personal data in the UK/EU, and the audit trail would still carry a commitment to them. Would a truncated IP, or an
   IP held only in the (later purged) database, be enough?
8. **Guardian signing for minors.** Is a parent or guardian signing as the buyer, on the buyer's own word and with no
   check, a reasonable position? Is a waiver signed for a minor enforceable in England and Wales, the EU Member States
   most likely to be used, and the US states most likely to be used? Should the product record the relationship or
   require a statement of authority? Should the "buyer for the whole group" mode be offered for adults?
9. **Tamper evidence without an external anchor.** The product uses an internal hash chain, with no trusted timestamp.
   Is that enough for an SES, or should the certificate say plainly that integrity depends on the host? Is the current
   certificate wording ("Anyone holding this PDF can check these values on the verify page") fair?
10. **Identity assurance.** Is "control of an email inbox" a fair basis for a waiver or low-value agreement? Should the
    product say, in the ceremony or on the certificate, that the identity of the signer is not verified? The Pro email
    OTP (section 6) proves access to the inbox a second time and is shown on the certificate as "Email one-time code
    verified": is that wording fair, and should it say more or less?
11. **Notice to other adults.** The buyer enters other attendees' email addresses and E-sign emails them. Who must give
    these people privacy notice, and what should the invitation say? Does the 10-per-booking limit address spam
    sufficiently?
12. **Roles and contracts.** Is the site owner the controller, and is the plugin maker neither controller nor processor
    because it receives no data? What terms or notices should the maker supply to site owners (privacy notice text, a
    record of processing template, a DPA if a hosted or licence service is ever added)?
13. **Subject requests.** Is an administrator-run erasure that leaves the signed record for its own period acceptable as a
    response to erasure requests (UK GDPR Article 17(3)(e), legal claims)? Is manual handling of access requests enough?
14. **Mail-scanner prefetch.** We now record "viewed" only when the signer submits. Is that view event still meaningful
    evidence, and should the wording of the certificate say so?
15. **Excluded document types.** Should the product warn site owners against using it for documents excluded from
    electronic signing in each region?
16. **Uploaded PDFs (section 5.6).** Is a signed copy made of the original file followed by an incremental update (stamps
    and certificate added after the untouched original) good evidence, or should the product produce a single flattened
    file? Is offering the PDF as a link (open or download) rather than shown inside the signing page enough to say the
    signer was shown the document, and should the page require the signer to open it before signing?

## 14. Changes since last review

None. This is the first issue. (Added before review: section 5.5, several signers in the Pro edition, T090; the Pro email one-time code in section 6, T091; and section 5.6, uploaded PDF documents in the Pro edition, T094.)

## 15. Code references

[C1] `packages/esign/CONTEXT.md` (what it is; Free/Pro split); `packages/esign/emdash-plugin.jsonc` (capabilities `email:send`, `network:request`, allowed host `challenges.cloudflare.com`).
[C2] `packages/esign/src/domain/pdf.ts`, `CERTIFICATE_WORDING`.
[C3] `packages/esign/src/domain/envelopes.ts`, header comment and `sendEnvelope` (snapshot frozen, `docSha256`).
[C4] `packages/esign/src/emails/templates.ts` (invitation and completion text, links only); `packages/esign/src/domain/envelopes.ts`, `SignerDoc.tokenHash`; `packages/esign/CONTEXT.md` ("Rules that bite": tokens, `Referrer-Policy: no-referrer`).
[C5] `packages/esign/src/astro/SigningCeremony.astro` (document, "Exact text you are signing", SHA-256 fingerprint, typed name, drawn pad, consent and intent checkboxes, Sign and Decline buttons, no-JS forms).
[C6] `packages/esign/src/routes/ceremony.ts`, header comment (`open: true`, no view on GET) and `session` handler; `packages/esign/CONTEXT.md` "Hardening (T117)".
[C7] `packages/esign/src/domain/signing.ts`, `DEFAULT_CONSENT_WORDING`, `DEFAULT_CONSENT_VERSION`; `packages/esign/emdash-plugin.jsonc`, `consentVersion` and `consentWording`; `tasks/T105-legal-brief-for-the-consent-and-retention-review.md` (T034 review note).
[C8] `packages/esign/src/routes/ceremony.ts`, `submit` (document-hash and consent-hash checks, `CONSENT_CHANGED`, three audit events, signer update); `packages/esign/src/domain/signing.ts`, `parseSubmit`, `signedAuditEvents`.
[C9] `packages/esign/src/routes/ceremony.ts`, `decline`; `packages/esign/src/domain/signing.ts`, `cleanReason`, `declinedAuditEvents` (reason kept off the chain).
[C10] `packages/esign/src/cron/pdf.ts` and `packages/esign/src/cron/completion-email.ts`; `packages/esign/CONTEXT.md` (Signed PDF built once; signed-copy link).
[C11] `packages/esign/src/astro/lib/csrf.ts`; `packages/esign/CONTEXT.md` (T034 review: cross-site posts refused).
[C12] `packages/esign/src/domain/pdf.ts`, `signedPdfDocument` ("Consent version", "Consent wording SHA-256"); `packages/esign/src/domain/envelopes.ts`, `SignerDoc`.
[C13] `packages/esign/src/routes/ceremony.ts`, `personalOf` (IP and user agent from `requestMeta`); `packages/esign/src/domain/signing.ts`, `RequestPersonal`; `packages/esign/CONTEXT.md` (T034: `callPublicRoute` copies headers so IP and user agent exist).
[C14] `packages/esign/src/domain/audit.ts` (hash chain, genesis, canonical form, create-only writes, `verifyAuditChain`, `finalEnvelopeHash`, header comment on what the verifier proves).
[C15] `packages/esign/src/domain/audit.ts`, `PERSONAL_FIELDS`, `commitPersonal`, `purgePersonal`; BUILD-PLAN section 12, R28.
[C16] `packages/esign/src/domain/signing.ts`, `bindSignature`.
[C17] `packages/esign/src/domain/pdf.ts`, `signedPdfDocument`, `entriesBlocks`, `renderSignedPdf`, `CAPACITY`; `packages/esign/CONTEXT.md` (T025).
[C18] `packages/esign/src/cron/retention.ts`, header comment ("Until the records period ends the signed PDF, snapshot and chain keep what they printed"); `packages/esign/README.md`, "Retention (operators)"; BUILD-PLAN section 12, R45.
[C19] `packages/esign/src/routes/verify.ts`; `packages/esign/src/astro/VerifyDocument.astro`; `packages/esign/CONTEXT.md` (T032: hashing in the browser, only `sha256` submitted).
[C20] `packages/esign/src/routes/public.ts` (`public/otp/send` and `public/otp/verify` declared; `notImplemented` handler returns `NOT_FOUND`); `packages/esign/emdash-plugin.jsonc`, `otpDefault`, `otpContractTemplates`; BUILD-PLAN section 12, R29 (no Turnstile on the ceremony).
[C21] `packages/esign/src/domain/envelopes.ts`, `SignerCapacity`, `SignerInput.participant`; `docs/protocol/esign-intent-v1.md` section 5.1 (`as`, `participant`).
[C22] `docs/protocol/esign-intent-v1.md` sections 1, 5.1 (issuer rules, waiver modes, prefill, return URL), 5.2; `packages/events/CONTEXT.md`, "Waivers (Pro)".
[C23] BUILD-PLAN section 12, R48; `docs/protocol/esign-intent-v1.md` section 5.1, "Issuer rules".
[C24] `docs/protocol/esign-intent-v1.md` section 5.2 (receipt fields); `packages/esign/src/domain/receipts.ts`.
[C25] `packages/events/CONTEXT.md` (check-in `WAIVER_PENDING`; "Without the seam (Free, also after a downgrade) waivers are not enforced", R44).
[C26] `packages/events/src/cron/retention.ts`; `packages/events/emdash-plugin.jsonc`, `retentionDays` (default 365).
[C27] BUILD-PLAN section 12, R32; `packages/esign/CONTEXT.md` (outbox rows scrubbed on send, retention removes old rows).
[C28] `packages/esign/src/cron/retention.ts`, `retentionCutoffs`, `retentionTick`, `RETENTION_SCHEDULE` (`23 3 * * *`), `closedMs`; `packages/esign/src/cron/expire.ts`; BUILD-PLAN section 12, R45, R46.
[C29] `packages/esign/src/cron/retention.ts`, `scrubSigner`, `scrubEnvelope`, `purgeAudit`, the `records` phase; `packages/esign/src/cron/nonce-sweep.ts`.
[C30] `packages/esign/src/cron/retention.ts`, `findForErasure`, `eraseOnRequest`, `waits`, `ON_REQUEST`; `packages/esign/src/admin/pages.ts`, `erasure`; `packages/esign/README.md`.
[C31] `packages/esign/emdash-plugin.jsonc`, `retentionPersonalDataMonths` (default 12, 1-120), `retentionSignedRecordsYears` (default 7, 1-50); BUILD-PLAN section 12, D4.
[C32] `packages/esign/emdash-plugin.jsonc` (declared capabilities and hosts); `packages/events/CONTEXT.md` and BUILD-PLAN section 3 (Stripe in the Pro edition only).
[C33] `packages/esign/src/astro/lib/csp.ts`; `packages/esign/src/routes/ceremony.ts` (rate limit, `TOKEN_IN_QUERY`); `packages/esign/src/domain/clients.ts` and `docs/protocol/esign-intent-v1.md` section 12 (keys derived per client).
[C34] `packages/esign/src/seams.ts` and `packages/esign/src/routes/ceremony.ts` (`ceremonyHandlers`, per-signer `signer.viewed` and `signer.declined`, Free refuses a several-signer submit); `packages/esign/src/domain/pdf.ts`, `signedPdfDocument` (every signer); `packages/esign/CONTEXT.md`, "Several signers (T090)". The routing itself is in the Pro edition.
[C35] `packages/esign/src/routes/ceremony.ts` (`OTP_REQUIRED`, session `otp`), `src/domain/pdf.ts` (certificate line); Pro repo `packages/esign-pro/src/domain/otp.ts`, `src/otp/routes.ts`, `src/otp/stamp.ts` (rules, routes, who needs a code).
[C36] `packages/esign/src/routes/ceremony.ts` (`document` in `public/session`, no text snapshot; Free refuses to sign it) and `src/astro/SigningCeremony.astro` (open and download links, no embed); Pro repo `packages/esign-pro/src/domain/pdf-templates.ts` (upload checks, fields, `PDF_CERTIFICATE_WORDING`), `src/pdf/update.ts` (the incremental update), `src/pdftemplates/` (upload, send, the document link, the signed-PDF job); BUILD-PLAN section 12, R53.
