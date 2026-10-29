# semics Events

Event bookings and ticketing for [EmDash CMS](https://emdashcms.com): events from your own collection,
ticket types, capacity, holds, a booking page, confirmation emails, calendar files, a waitlist, recurring
events, slot schedules (several bookable time slots a day from one schedule, with a day view to close, reopen
or re-size slots, booked by picking a day on a month calendar, then a time), optional booking approval with admin notifications, and check-in. MIT licensed.

The package holds the sandboxed core `semics-events` (its default export) and the UI kit (`/ui`,
`/integration`, and the Astro components under `/astro/*.astro`).

**Documentation** (in `apps/docs/pages` of the repository):
[install](https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/install.md),
[configure](https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/configure.md), the
[Events guide](https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/events.md),
[pages and components](https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/site-pages.md),
[data and retention](https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/privacy.md).

## Install

```sh
pnpm add @semics-tech/emdash-events @emdash-cms/sandbox-workerd
```

```js
// astro.config.mjs
import semicsEvents from "@semics-tech/emdash-events";
import { eventsIntegration } from "@semics-tech/emdash-events/integration";
import { eventsUi } from "@semics-tech/emdash-events/ui";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

export default defineConfig({
	output: "server",
	integrations: [
		eventsIntegration(),
		emdash({
			siteUrl: "https://events.example.com",
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			sandboxed: [semicsEvents],
			plugins: [eventsUi()],
		}),
	],
});
```

With E-sign on the same site, use `@semics-tech/emdash-events-suite` instead.

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
