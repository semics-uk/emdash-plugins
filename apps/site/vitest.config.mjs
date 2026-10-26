import { defineConfig } from "vitest/config";
import { machineLimits } from "../../vitest.limits.mjs";

// Plain Node tests: the test builds the site into dist/ itself (no workerd, no browser).
export default defineConfig({ test: { ...machineLimits, environment: "node" } });
