import { fileURLToPath } from "node:url";
import {
	BUNDLE_BUDGET,
	BUNDLE_HEADROOM,
	backendBytes,
	kib,
	REGISTRY_FILE_LIMIT,
} from "@semics-tech/shared/testing/bundle-size";
import { describe, expect, it } from "vitest";

const pluginDir = fileURLToPath(new URL("..", import.meta.url));

describe("esign backend bundle size (R42)", () => {
	it("R42 backend.js leaves at least 24 KiB under the registry's 128 KiB per-file cap", async () => {
		expect(REGISTRY_FILE_LIMIT - BUNDLE_BUDGET).toBeGreaterThanOrEqual(BUNDLE_HEADROOM);
		const bytes = await backendBytes(pluginDir);
		expect(bytes, `backend.js is ${kib(bytes)}, budget ${kib(BUNDLE_BUDGET)}`).toBeLessThanOrEqual(BUNDLE_BUDGET);
	});
});
