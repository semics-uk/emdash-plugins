import type { SandboxedPlugin } from "emdash/plugin";
import { runPdfJob } from "./cron/pdf";
import { CEREMONY_HANDLERS } from "./routes/ceremony";
import { downloadHandler } from "./routes/download";
import { ENVELOPE_ROUTES, fromIntentHandler } from "./routes/envelopes";
import { publicRoutes } from "./routes/public";
import { TEMPLATE_ROUTES } from "./routes/templates";

/** Sandboxed plugin entry. Route handlers are filled in by the tasks that own each route. */
const plugin: SandboxedPlugin = {
	hooks: {
		cron: async (event, ctx) => {
			await runPdfJob(event, ctx);
		},
	},
	routes: {
		...publicRoutes({
			"public/envelopes/from-intent": fromIntentHandler,
			"public/download": downloadHandler,
			...CEREMONY_HANDLERS,
		}),
		...TEMPLATE_ROUTES,
		...ENVELOPE_ROUTES,
	},
};

export default plugin;
