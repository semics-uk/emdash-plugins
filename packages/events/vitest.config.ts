import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { configDefaults, defineConfig } from "vitest/config";
import { coverageConfig } from "../../vitest.coverage.mjs";
import { machineLimits } from "../../vitest.limits.mjs";

const sharedFixture = "tests/fixtures/shared-plugin";
// Same manifest as the real plugin (symlink) plus probe routes that drive storage and fetch.
const contractFixture = "tests/fixtures/contract-probe";
// Same manifest again, with probe routes that drive the inventory module on D1 (T044).
const inventoryFixture = "tests/fixtures/inventory-probe";
// Cold workerd starts and plugin builds are slow when several packages verify in parallel.
const testTimeout = 120_000;

// Four projects: the real plugin in workerd; a test-only fixture plugin that imports
// @semics-tech/shared (host proof); the contract probe (real manifest, storage/fetch routes); and a plain Node project that checks build output.
export default defineConfig({
	test: {
		...machineLimits,
		coverage: coverageConfig(),
		projects: [
			{
				plugins: [emdashPluginTest()],
				test: {
					name: "core",
					testTimeout,
					hookTimeout: testTimeout,
					exclude: [
						...configDefaults.exclude,
						"tests/shared-bundle*.test.ts",
						"tests/contract.test.ts",
						"tests/inventory.test.ts",
						"tests/holds.test.ts",
						"tests/manifest.test.ts",
						"tests/fixtures/**",
					],
				},
			},
			{
				plugins: [emdashPluginTest({ dir: sharedFixture })],
				test: { name: "shared-host", testTimeout, include: ["tests/shared-bundle.test.ts"] },
			},
			{
				plugins: [emdashPluginTest({ dir: contractFixture })],
				test: { name: "contract", testTimeout, hookTimeout: testTimeout, include: ["tests/contract.test.ts"] },
			},
			{
				plugins: [emdashPluginTest({ dir: inventoryFixture })],
				test: { name: "inventory", testTimeout, hookTimeout: testTimeout, include: ["tests/inventory.test.ts", "tests/holds.test.ts"] },
			},
			{
				test: { name: "manifest", environment: "node", testTimeout, include: ["tests/manifest.test.ts"] },
			},
			{
				test: {
					name: "shared-build",
					environment: "node",
					testTimeout,
					hookTimeout: testTimeout,
					include: ["tests/shared-bundle.build.test.ts"],
				},
			},
		],
	},
});
