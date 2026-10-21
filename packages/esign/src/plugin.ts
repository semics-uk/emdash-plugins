import type { SandboxedPlugin } from "emdash/plugin";
import { ENVELOPE_ROUTES, fromIntentHandler } from "./routes/envelopes";
import { publicRoutes } from "./routes/public";
import { TEMPLATE_ROUTES } from "./routes/templates";

/** Sandboxed plugin entry. Route handlers are filled in by the tasks that own each route. */
const plugin: SandboxedPlugin = {
	routes: {
		...publicRoutes({ "public/envelopes/from-intent": fromIntentHandler }),
		...TEMPLATE_ROUTES,
		...ENVELOPE_ROUTES,
	},
};

export default plugin;
