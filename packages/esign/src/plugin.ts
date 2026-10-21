import type { SandboxedPlugin } from "emdash/plugin";
import { publicRoutes } from "./routes/public";
import { TEMPLATE_ROUTES } from "./routes/templates";

/** Sandboxed plugin entry. Route handlers are filled in by the tasks that own each route. */
const plugin: SandboxedPlugin = {
	routes: { ...publicRoutes(), ...TEMPLATE_ROUTES },
};

export default plugin;
