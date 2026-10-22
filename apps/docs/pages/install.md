# Install

You can run Events alone, E-sign alone, or both. If you run both, use the suite: one call wires
everything, and waivers need it.

## 1. Add the packages

Both products, linked:

```sh
pnpm add @semics-tech/emdash-events @semics-tech/emdash-esign @semics-tech/emdash-events-suite @emdash-cms/sandbox-workerd
```

One product only:

```sh
pnpm add @semics-tech/emdash-events @emdash-cms/sandbox-workerd
```

Each product package carries both halves: the sandboxed core (its default export) and the UI kit
(`/ui`, `/integration` and the Astro components).

## 2. Add them to `astro.config.mjs`

### Events and E-sign together

```js
// astro.config.mjs
import node from "@astrojs/node";
import { eventsSuite } from "@semics-tech/emdash-events-suite";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

const suite = eventsSuite();

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	integrations: [
		...suite.integrations,
		emdash({
			siteUrl: "https://events.example.com",
			database: sqlite({ url: "file:./data.db" }),
			storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			sandboxed: suite.sandboxed,
			plugins: suite.plugins,
		}),
	],
});
```

`eventsSuite()` returns both sandboxed cores, both UI plugins, and three Astro integrations: Events,
E-sign and the suite's own pages. Each part is told the plugin id of each core it calls.

### Events only

```js
// astro.config.mjs
import node from "@astrojs/node";
import semicsEvents from "@semics-tech/emdash-events";
import { eventsIntegration } from "@semics-tech/emdash-events/integration";
import { eventsUi } from "@semics-tech/emdash-events/ui";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	integrations: [
		eventsIntegration(),
		emdash({
			siteUrl: "https://events.example.com",
			database: sqlite({ url: "file:./data.db" }),
			storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			sandboxed: [semicsEvents],
			plugins: [eventsUi()],
		}),
	],
});
```

### E-sign only

```js
// astro.config.mjs
import node from "@astrojs/node";
import semicsEsign from "@semics-tech/emdash-esign";
import { esignIntegration } from "@semics-tech/emdash-esign/integration";
import { esignUi } from "@semics-tech/emdash-esign/ui";
import { defineConfig } from "astro/config";
import emdash, { local } from "emdash/astro";
import { sqlite } from "emdash/db";

export default defineConfig({
	output: "server",
	adapter: node({ mode: "standalone" }),
	integrations: [
		esignIntegration(),
		emdash({
			siteUrl: "https://sign.example.com",
			database: sqlite({ url: "file:./data.db" }),
			storage: local({ directory: "./uploads", baseUrl: "/_emdash/api/media/file" }),
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			sandboxed: [semicsEsign],
			plugins: [esignUi()],
		}),
	],
});
```

The database, storage and adapter lines are examples. Use whatever your EmDash site already uses.

## 3. Cores installed from the registry

The plugin registry can install the Free cores, but not the UI kits. A registry install gives the core a
plugin id of the form `r_…` instead of the slug. Install the npm package for the UI kit as above, leave the
core out of `sandboxed`, and tell the UI the id:

```js
// astro.config.mjs
import { eventsSuite } from "@semics-tech/emdash-events-suite";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";

// The ids EmDash gave the cores when it installed them from the registry (they start with r_).
const suite = eventsSuite({ events: { pluginId: "r_events_id" }, esign: { pluginId: "r_esign_id" } });

export default defineConfig({
	output: "server",
	integrations: [
		...suite.integrations,
		emdash({
			siteUrl: "https://events.example.com",
			sandboxRunner: "@emdash-cms/sandbox-workerd/sandbox",
			// No cores here: the registry installed them. Only the UI plugins.
			plugins: suite.plugins,
		}),
	],
});
```

With one product, pass the id to its integration instead: `eventsIntegration({ pluginId })` or
`esignIntegration({ pluginId })`.

## 4. Events: add an events collection

Events reads each event from a collection on your site. By default it expects a collection `events` with
these fields. You can map other names in the settings ([Configure](configure.md#events-settings)).

| Field | Type | Needed |
| --- | --- | --- |
| `title` | string | Recommended (emails say "Event" without it) |
| `starts_at` | datetime | Yes: an entry without a start cannot be booked |
| `ends_at` | datetime | No (calendar files then use one hour) |
| `timezone` | string, an IANA zone such as `Europe/London` | Recommended (times show in UTC without it) |
| `venue` | string | No |

A seed file that creates the collection (add it to your seed, or apply it with `npx emdash seed`):

```json
{
	"$schema": "https://emdashcms.com/seed.schema.json",
	"version": "1",
	"collections": [
		{
			"slug": "events",
			"label": "Events",
			"labelSingular": "Event",
			"urlPattern": "/events/{slug}",
			"supports": ["drafts", "revisions", "preview", "search", "seo"],
			"fields": [
				{ "slug": "title", "label": "Title", "type": "string", "required": true, "searchable": true },
				{ "slug": "body", "label": "Body", "type": "portableText", "searchable": true },
				{ "slug": "starts_at", "label": "Starts at", "type": "datetime", "required": true },
				{ "slug": "ends_at", "label": "Ends at", "type": "datetime" },
				{ "slug": "timezone", "label": "Time zone (IANA)", "type": "string", "required": true },
				{ "slug": "venue", "label": "Venue", "type": "string" },
				{ "slug": "image", "label": "Image", "type": "image" },
				{ "slug": "summary", "label": "Summary", "type": "text" }
			]
		}
	]
}
```

## 5. Set the secrets key and site URL

Before you save any secret setting (Turnstile secret, pairing string, licence key), EmDash needs an
encryption key. Generate one and keep a backup: losing it loses every secret encrypted with it.

```sh
npx emdash secrets generate
```

Then set it, with the site's public address, in the server's environment:

```sh
EMDASH_ENCRYPTION_KEY=paste-the-generated-value-here
EMDASH_SITE_URL=https://events.example.com
```

`EMDASH_SITE_URL` does the same as `siteUrl` in the config. Set one of them. Emails need it: a scheduled
job has no request to read the address from. See [Configure](configure.md).

## 6. Check the install

Open the EmDash admin. Under the plugin you will find:

- Events: **Bookings**, **Attendees**, **Event editor** and **Setup check** pages, a **Ticket sales** widget
  on the dashboard, and a **Tickets & booking** panel on saved event entries.
- E-sign: **Envelopes**, **Templates**, **Integrations** and **Settings** pages.

The Events **Setup check** page shows the field mapping and whether a Turnstile secret is saved.

## Pro builds

Events Pro and E-sign Pro are the same plugins (same slug, same data) built with more features. They come
from a private npm package (`@semics-tech/emdash-events-pro`, `@semics-tech/emdash-esign-pro`). Put the Pro
package's default export in `sandboxed` where the Free core was (with the suite:
`eventsSuite({ events: <the Pro export> })`), then paste the licence key into the plugin's
**Licence key (Pro)** setting. Switching back to Free keeps all data. See [Free and Pro](editions.md).

## Develop the plugins themselves

In a clone of this repository:

```sh
corepack pnpm@10.23.0 install
corepack pnpm@10.23.0 verify
corepack pnpm@10.23.0 --filter docs build
```

`verify` runs every gate: lint, the task board, script tests, each package's validate, typecheck, tests and
build, these docs, and the release dry run.
