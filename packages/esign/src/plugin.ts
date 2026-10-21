import type { SandboxedPlugin } from "emdash/plugin";
import { publicRoutes } from "./routes/public";

/** Sandboxed plugin entry. Route handlers are filled in by the tasks that own each route. */
const plugin: SandboxedPlugin = {
	routes: publicRoutes(),
};

export default plugin;
