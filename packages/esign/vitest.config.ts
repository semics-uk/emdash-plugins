import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { configDefaults, defineConfig } from "vitest/config";
import { coverageConfig } from "../../vitest.coverage.mjs";

const sharedFixture = "tests/fixtures/shared-plugin";
// Cold workerd starts and plugin builds are slow when several packages verify in parallel.
const testTimeout = 120_000;

// Three projects: the real plugin in workerd; a test-only fixture plugin that imports
// @semics-tech/shared (host proof); and a plain Node project that checks build output.
export default defineConfig({
	test: {
		coverage: coverageConfig(),
		projects: [
			{
				plugins: [emdashPluginTest()],
				test: {
					name: "core",
					testTimeout,
					exclude: [...configDefaults.exclude, "tests/shared-bundle*.test.ts", "tests/fixtures/**"],
				},
			},
			{
				plugins: [emdashPluginTest({ dir: sharedFixture })],
				test: { name: "shared-host", testTimeout, include: ["tests/shared-bundle.test.ts"] },
			},
			{
				test: {
					name: "shared-build",
					environment: "node",
					testTimeout,
					include: ["tests/shared-bundle.build.test.ts"],
				},
			},
		],
	},
});
