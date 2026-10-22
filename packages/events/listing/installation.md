1. Install the core from the registry, or with npm together with the UI kit:

```sh
pnpm add @semics-tech/emdash-events @emdash-cms/sandbox-workerd
```

2. Add the integration and the UI plugin to `astro.config.mjs`. A core installed from the registry has an
   `r_…` id: pass it as `eventsIntegration({ pluginId })` and leave the core out of `sandboxed`.

```js
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

3. Create an `events` collection (title, `starts_at`, `ends_at`, `timezone`, `venue`), or map yours in the
   settings.
4. Set `EMDASH_ENCRYPTION_KEY`, an email provider, and Turnstile keys.
5. On an event entry, open **Tickets & booking** and choose **Enable booking**.

Full guide: https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/install.md
