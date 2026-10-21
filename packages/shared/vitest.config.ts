import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { configDefaults, defineConfig } from "vitest/config";
import { coverageConfig } from "../../vitest.coverage.mjs";

const budgetFixture = "tests/fixtures/budget-plugin";
// Cold workerd starts and plugin builds are slow when several packages verify in parallel.
const testTimeout = 120_000;

// Two projects: plain unit tests in Node, and the T007 budget harness tests, which run a
// fixture plugin through the Worker Loader sandbox host (tests/**/*.host.test.ts).
export default defineConfig({
	test: {
		coverage: coverageConfig({ allSource: true }),
		projects: [
			{
				test: {
					name: "unit",
					environment: "node",
					exclude: [...configDefaults.exclude, "tests/**/*.host.test.ts", "tests/fixtures/**"],
				},
			},
			{
				plugins: [emdashPluginTest({ dir: budgetFixture })],
				test: { name: "budget-host", testTimeout, include: ["tests/**/*.host.test.ts"] },
			},
		],
	},
});
