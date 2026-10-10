import type { PluginDescriptor, ResolvedPlugin } from "emdash";
import { definePlugin } from "emdash";

const ID = "semics-events-ui";
const VERSION = "0.1.0";

/** Native UI plugin descriptor. Add to `plugins: [eventsUi()]` beside the sandboxed core. */
export function eventsUi(): PluginDescriptor {
	return {
		id: ID,
		version: VERSION,
		entrypoint: "@semics-tech/emdash-events/ui",
		componentsEntry: "@semics-tech/emdash-events/astro",
	};
}

/** Runtime entry: the UI plugin has no capabilities, storage, hooks or routes. */
export function createPlugin(): ResolvedPlugin {
	return definePlugin({ id: ID, version: VERSION });
}

export default createPlugin;
