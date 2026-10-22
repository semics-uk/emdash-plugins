import { defineConfig } from "vitest/config";
import { coverageConfig } from "../../vitest.coverage.mjs";
import { machineLimits } from "../../vitest.limits.mjs";

// Plain Node tests: the suite has no sandboxed core. The flow runs through the real UI helpers of
// both products against a faked in-process route handler (`locals.emdash.handlePublicPluginApiRoute`).
export default defineConfig({
	test: {
		...machineLimits,
		environment: "node",
		coverage: coverageConfig(),
	},
});
