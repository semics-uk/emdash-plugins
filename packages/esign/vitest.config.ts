import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { configDefaults, defineConfig } from "vitest/config";
import { coverageConfig } from "../../vitest.coverage.mjs";
import { machineLimits } from "../../vitest.limits.mjs";

const sharedFixture = "tests/fixtures/shared-plugin";
const storageFixture = "tests/fixtures/storage-probe";
// Cold workerd starts and plugin builds are slow when several packages verify in parallel.
const testTimeout = 120_000;

// Four projects: the real plugin in workerd; a test-only fixture plugin that imports
// @semics-tech/shared (host proof); a fixture that shares the real manifest and probes storage
// indexes and the network allow-list; and a plain Node project that checks build output.
export default defineConfig({
	test: {
		...machineLimits,
		// The audit chain is a security module: 100% branches (tasks/README.md).
		coverage: coverageConfig({ strictBranches: ["src/domain/audit.ts"] }),
		projects: [
			{
				plugins: [emdashPluginTest()],
				test: {
					name: "core",
					testTimeout,
					exclude: [
						...configDefaults.exclude,
						"tests/shared-bundle*.test.ts",
						"tests/storage-host.test.ts",
						"tests/ui/*.build.test.ts",
						"tests/fixtures/**",
					],
				},
			},
			{
				plugins: [emdashPluginTest({ dir: sharedFixture })],
				test: { name: "shared-host", testTimeout, include: ["tests/shared-bundle.test.ts"] },
			},
			{
				plugins: [emdashPluginTest({ dir: storageFixture })],
				test: { name: "storage-host", testTimeout, include: ["tests/storage-host.test.ts"] },
			},
			{
				test: { name: "ui-build", environment: "node", include: ["tests/ui/*.build.test.ts"] },
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
