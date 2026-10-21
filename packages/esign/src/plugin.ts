import type { SandboxedPlugin } from "emdash/plugin";
import { runCompletionEmailJob } from "./cron/completion-email";
import { runPdfJob } from "./cron/pdf";
import { runOutboxJob, scheduleOutbox } from "./emails/outbox";
import { CEREMONY_HANDLERS } from "./routes/ceremony";
import { downloadHandler } from "./routes/download";
import { ENVELOPE_ROUTES, fromIntentHandler } from "./routes/envelopes";
import { publicRoutes } from "./routes/public";
import { TEMPLATE_ROUTES } from "./routes/templates";
import { verifyHandler } from "./routes/verify";

/** Sandboxed plugin entry. Route handlers are filled in by the tasks that own each route. */
const plugin: SandboxedPlugin = {
	hooks: {
		"plugin:activate": async (_event, ctx) => scheduleOutbox(ctx),
		cron: async (event, ctx) => {
			if (await runOutboxJob(event, ctx)) return;
			if (await runCompletionEmailJob(event, ctx)) return;
			await runPdfJob(event, ctx);
		},
	},
	routes: {
		...publicRoutes({
			"public/envelopes/from-intent": fromIntentHandler,
			"public/download": downloadHandler,
			"public/verify": verifyHandler,
			...CEREMONY_HANDLERS,
		}),
		...TEMPLATE_ROUTES,
		...ENVELOPE_ROUTES,
	},
};

export default plugin;
