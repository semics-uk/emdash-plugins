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

/** Runtime entry: no capabilities, storage, hooks or routes. The pages come from the integration; it registers the editor block only. */
export function createPlugin(): ResolvedPlugin {
	return definePlugin({
		id: ID,
		version: VERSION,
		admin: {
			portableTextBlocks: [
				{
					type: "esign-request",
					label: "Self-serve signing form",
					icon: "code",
					description: "A form that emails the visitor a link to sign a self-serve template (E-sign Pro)",
					category: "E-sign",
					fields: [
						{ type: "text_input", action_id: "template", label: "Template ID" },
						{ type: "text_input", action_id: "heading", label: "Heading", initial_value: "Sign this document" },
					],
				},
			],
		},
	});
}

export default createPlugin;
