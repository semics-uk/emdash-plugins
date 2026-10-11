import { resolve } from "node:path";
import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { defineConfig } from "vitest/config";

// Probe-only config: builds tests/probes/fixture as the plugin under test.
export default defineConfig({
	plugins: [emdashPluginTest({ dir: resolve(import.meta.dirname, "fixture") })],
	test: { testTimeout: 120000, hookTimeout: 120000, include: ["tests/probes/*.probe.ts"], root: resolve(import.meta.dirname, "../..") },
});
