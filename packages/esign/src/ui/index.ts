import type { PluginDescriptor, ResolvedPlugin } from "emdash";
import { definePlugin } from "emdash";

const ID = "semics-esign-ui";
const VERSION = "0.1.0";

/** Native UI plugin descriptor. Add to `plugins: [esignUi()]` beside the sandboxed core. */
export function esignUi(): PluginDescriptor {
	return {
		id: ID,
		version: VERSION,
		entrypoint: "@semics-tech/emdash-esign/ui",
		componentsEntry: "@semics-tech/emdash-esign/astro",
	};
}

/** Runtime entry: no capabilities, storage, hooks or routes. The pages come from the integration. */
export function createPlugin(): ResolvedPlugin {
	return definePlugin({ id: ID, version: VERSION });
}

export default createPlugin;
