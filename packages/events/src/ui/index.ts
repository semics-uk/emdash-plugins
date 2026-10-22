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

/** Runtime entry: no capabilities, storage, hooks or routes; it registers editor blocks only. */
export function createPlugin(): ResolvedPlugin {
	return definePlugin({
		id: ID,
		version: VERSION,
		admin: {
			portableTextBlocks: [
				{
					type: "events-booking",
					label: "Book an event",
					icon: "code",
					description: "A booking form for one event",
					category: "Events",
					fields: [
						{ type: "text_input", action_id: "event", label: "Event (entry ID or slug)" },
						{ type: "text_input", action_id: "heading", label: "Heading", initial_value: "Book tickets" },
					],
				},
				{
					type: "events-list",
					label: "Events list",
					icon: "code",
					description: "A list of upcoming events",
					category: "Events",
					fields: [
						{ type: "text_input", action_id: "heading", label: "Heading", initial_value: "Upcoming events" },
						{ type: "number_input", action_id: "limit", label: "Number of events", initial_value: 3, min: 1, max: 20 },
					],
				},
			],
		},
	});
}

export default createPlugin;
