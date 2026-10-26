# semics E-sign

Simple electronic signatures for [EmDash CMS](https://emdashcms.com): Markdown templates, one signer per
envelope, a typed name with an optional drawn signature, a hash-chained audit trail, a signed PDF with a certificate, and a public
`/verify` page. MIT licensed.

The package holds the sandboxed core `semics-esign` (its default export) and the UI kit (`/ui`,
`/integration`, and the Astro pages and components).

**Documentation** (in `apps/docs/pages` of the repository):
[install](https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/install.md),
[configure](https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/configure.md), the
[E-sign guide](https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/esign.md),
[data and retention](https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/privacy.md).

## Install

```sh
pnpm add @semics-tech/emdash-esign @emdash-cms/sandbox-workerd
```

```js
// astro.config.mjs
import semicsEsign from "@semics-tech/emdash-esign";
import { esignIntegration } from "@semics-tech/emdash-esign/integration";
import { esignUi } from "@semics-tech/emdash-esign/ui";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

export default defineConfig({
	output: "server",
	integrations: [
		esignIntegration(),
		emdash({
			siteUrl: "https://sign.example.com",
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			sandboxed: [semicsEsign],
			plugins: [esignUi()],
		}),
	],
});
```

## Retention (operators)

Settings: **Keep personal data (months)**, default 12, and **Keep signed records (years)**, default 7. Both count
from when an envelope closed (completed, declined, voided or expired; a draft from its last edit). A daily job
then:

- after the personal-data period, deletes the signer's name, email, IP address, browser, typed name and drawn
  strokes, the values they entered, any decline reason and their links, the envelope's prefilled values and
  return URL, and the audit trail's raw personal values together with the salt that could prove them. Drafts
  are deleted. The audit trail itself still verifies. These are the separate copies: the signed record keeps
  what it printed (next point).
- keeps the **signed record** (the signed PDF, the frozen document and the audit trail) until the
  signed-records period ends. The signed PDF and document still show what was signed: the document may contain
  the signer's name or email (`{{signer.name}}`, `{{signer.email}}`); the certificate prints the signer's name
  and IP address, and the participant's name (a minor's name, when a guardian signed); and the signed PDF keeps
  the values the signer entered under "Details entered by the signer". All of this stays until the
  signed-records period ends. `/verify` keeps matching the PDF during this period.
- after the signed-records period, deletes the PDF, document, audit trail and signer record; `/verify` no
  longer recognises the PDF.

Envelopes still out for signature are never purged. An unsigned one expires `expiryDays` after it was sent (an
hourly job closes it, so retention can age it out); you can also void it. To delete one person's data on
request, use **Delete personal data** on the Envelopes page (signer email or envelope id). It removes the
personal data straight away but keeps the signed record for its own period.

## Develop

```sh
pnpm install
pnpm run validate
pnpm run typecheck
pnpm run test
pnpm run build
```

`pnpm run test` builds the plugin and runs its tests through Worker Loader using EmDash's production sandbox
wrapper and host bridge. To try it on a site, run `pnpm run dev` here (rebuilds on save) and link this folder
into the site.

## Publish

```sh
pnpm run login -- alice.example.com
pnpm run registry:publish # builds and uploads artifacts to your PDS
```

To publish from GitHub Actions, run `pnpm run release:setup`. The command creates one shared workflow at the
Git repository root.

The registry listing (name, keywords, the description, installation, FAQ and security sections, icon, banner
and screenshots) is declared in `emdash-plugin.jsonc` and kept in `listing/`. The images are made by the
playground's `e2e/t103-screenshots.spec.ts`.

## Version bumps

Bump `version` in `package.json` when you ship a release. The scaffold's `emdash-plugin.jsonc` deliberately
omits `version`: the build reads it from `package.json` so there's a single source of truth. **Bump major** for
breaking changes, **bump minor** for new routes or hooks, **bump patch** for fixes.

You MUST bump version whenever you change `capabilities`, `allowedHosts`, or `storage` in the manifest.
Installed users have consented to the old trust contract; a change without a version bump would let new
behaviour slip past consent.
