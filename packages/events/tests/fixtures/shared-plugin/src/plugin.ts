import { sharedVersion } from "@semics-tech/shared";
import type { SandboxedPlugin } from "emdash/plugin";

/**
 * Test-only plugin (never published). It imports `@semics-tech/shared` so the tests can prove the
 * emdash-plugin bundler inlines workspace TypeScript into the sandbox bundle.
 */
const plugin: SandboxedPlugin = {
	routes: {
		version: {
			handler: async () => ({ version: sharedVersion() }),
		},
	},
};

export default plugin;
