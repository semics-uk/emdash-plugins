Simple electronic signatures for EmDash (ESIGN and UETA in the US; a simple electronic signature under eIDAS
in the UK and EU). Write Markdown templates with placeholders, send an envelope to one signer, and get back a
signed PDF with a certificate.

- The signer agrees to your consent wording and types their name (drawing a signature too is optional), or
  declines.
- Every step is an event in a hash-chained audit trail. Personal values enter the chain only as salted
  hashes, so retention can delete them without breaking it.
- The signed PDF is built once and its hash stored. Anyone can check a PDF on `/verify`; only its hash leaves
  their browser.
- Unsigned envelopes expire; personal data and signed records each have a retention period you set.
- Other systems can start signatures through a documented, signed protocol (`esign-intent/1`).
- English and Arabic built in; tested against WCAG 2.2 AA at 320 px.

The signing pages come from the npm package `@semics-tech/emdash-esign` (the registry delivers the core only).

E-sign Pro (same plugin, separate licence) adds several signers, an email one-time code, reminders, uploaded
PDF templates, self-serve forms, bulk send and MCP tools.

Documentation: https://github.com/semics-uk/emdash-plugins/tree/main/apps/docs/pages
