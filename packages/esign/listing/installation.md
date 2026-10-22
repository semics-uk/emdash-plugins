1. Install the core from the registry, or with npm together with the UI kit:

```sh
pnpm add @semics-tech/emdash-esign @emdash-cms/sandbox-workerd
```

2. Add the integration and the UI plugin to `astro.config.mjs`. A core installed from the registry has an
   `r_…` id: pass it as `esignIntegration({ pluginId })` and leave the core out of `sandboxed`.

```js
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

3. Set the site URL (`siteUrl` or `EMDASH_SITE_URL`): without it no signing email is sent.
4. Set `EMDASH_ENCRYPTION_KEY` and an email provider.
5. Write a template on **Templates**, then send an envelope from **Envelopes**.

Full guide: https://github.com/semics-uk/emdash-plugins/blob/main/apps/docs/pages/install.md
