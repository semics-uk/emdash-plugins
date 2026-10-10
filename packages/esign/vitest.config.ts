import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { defineConfig } from "vitest/config";
import { coverageConfig } from "../../vitest.coverage.mjs";

export default defineConfig({
	plugins: [emdashPluginTest()],
	test: { coverage: coverageConfig() },
});
