# FAQ

## Do I need both plugins?

No. Events and E-sign work on their own. Install both, with the suite, only if you want event waivers.

## Can the registry install everything?

The registry installs the sandboxed cores only. The pages and components come from the npm packages
([Install](install.md#3-cores-installed-from-the-registry)).

## Does it work on Cloudflare?

Yes. Both cores run in EmDash's sandbox, which on Cloudflare is the Worker Loader. On Cloudflare, EmDash reads
the visitor's IP address itself, so you set no proxy headers.

## Can people book without JavaScript?

Yes. The booking form, the booking page, the waiver form, the signing page (with a typed name) and `/verify`
all work without JavaScript.

## Can the same person book twice?

Yes. Bookings are not limited per email. They are limited to 10 per visitor IP address in 10 minutes.

## What happens to bookings if I delete an event?

EmDash will not move an event with live bookings to the bin. If an event is deleted permanently anyway, its
bookings stay and the event is marked orphaned.

## Is an E-sign signature legally binding?

E-sign makes simple electronic signatures (ESIGN and UETA, eIDAS simple electronic signature). Many
agreements can be signed that way; some cannot. Ask your lawyer. The
[legal brief](../../../docs/legal/brief.md) describes exactly what is recorded.

## Can I change a template after sending?

Yes. Saving a template makes a new version. Envelopes already sent keep the text they were sent with: that
text was frozen and hashed when it was sent.

## Can anyone check a signed PDF?

Yes, on `/verify`. Only the file's hash leaves their browser. After the signed-records period the record is
deleted and `/verify` no longer recognises the file.

## Does moving to Pro, or back, lose data?

No. Pro is the same plugin with more features and reads the same data ([Free and Pro](editions.md)).

## Which languages are included?

English and Arabic for what visitors see on the Events and E-sign pages and components. Emails, calendar
files, the admin and the suite's waiver pages are English ([Translations](translations.md)).

## Where do I report a security problem?

Email security@semics.co.uk. Please do not open a public issue.
