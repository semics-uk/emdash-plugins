# semics-esign

A sandboxed plugin for [EmDash CMS](https://emdashcms.com).

## Retention (operators)

Settings: **Keep personal data (months)**, default 12, and **Keep signed records (years)**, default 7. Both count from when an
envelope closed (completed, declined, voided or expired; a draft from its last edit). A daily job then:

- after the personal-data period, deletes the signer's name, email, IP address, browser, typed name and drawn strokes, the
  values they entered, any decline reason and their links, the envelope's prefilled values and return URL, and the audit
  trail's raw personal values together with the salt that could prove them. Drafts are deleted. The audit trail itself
  still verifies.
- keeps the **signed record** (the signed PDF, the frozen document and the audit trail) until the signed-records period
  ends. The signed PDF and document still show what was signed: the document may contain the signer's name or email
  (`{{signer.name}}`, `{{signer.email}}`) and the certificate prints the signer's name and IP address. `/verify` keeps
  matching the PDF during this period.
- after the signed-records period, deletes the PDF, document, audit trail and signer record; `/verify` no longer
  recognises the PDF.

Envelopes still out for signature are never purged. An unsigned one expires `expiryDays` after it was sent (an hourly
job closes it, so retention can age it out); you can also void it. To delete one person's data on request,
use **Delete personal data** on the Envelopes page (signer email or envelope id). It removes the personal data straight away
but keeps the signed record for its own period.

## Develop

```sh
pnpm install
pnpm run validate
pnpm run typecheck
pnpm run test
pnpm run build
```

To test against a running EmDash site, run `pnpm run dev` in this
directory (rebuilds on save) and `pnpm add file:../path/to/this`
in the site. Then `import semicsEsign from "semics-esign"` and pass
it into `emdash({ sandboxed: [semicsEsign] })`.

`pnpm run test` builds the plugin and runs its tests through Worker Loader using
EmDash's production sandbox wrapper and host bridge.

## Publish

```sh
pnpm run login -- alice.example.com
pnpm run publish          # builds and uploads artifacts to your PDS
```

To publish from GitHub Actions, run `pnpm run release:setup`. The command
creates one shared workflow at the Git repository root.

## Version bumps

Bump `version` in `package.json` when you ship a release. The
scaffold's `emdash-plugin.jsonc` deliberately omits `version` —
the build pipeline reads it from `package.json` so there's a single
source of truth. **Bump major** for breaking changes, **bump minor**
for new routes or hooks, **bump patch** for fixes.

You MUST bump version whenever you change `capabilities`, `allowedHosts`,
or `storage` in the manifest. Installed users have consented to the
old trust contract; a change without a version bump would let new
behaviour slip past consent.
