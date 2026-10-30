import { fileURLToPath } from "node:url";
import {
	backendBytes,
	EVENTS_BUNDLE_BUDGET,
	EVENTS_HOTFIX_ROOM,
	kib,
	REGISTRY_FILE_LIMIT,
} from "@semics-tech/shared/testing/bundle-size";
import { describe, expect, it } from "vitest";

const pluginDir = fileURLToPath(new URL("..", import.meta.url));

describe("events backend bundle size (R42, R51, R94, R100)", () => {
	it("R94 R100 backend.js stays 4 KiB under its 125 KiB budget, itself 3 KiB under the registry's 128 KiB per-file cap", async () => {
		expect(REGISTRY_FILE_LIMIT - EVENTS_BUNDLE_BUDGET).toBeGreaterThanOrEqual(3 * 1024);
		expect(EVENTS_HOTFIX_ROOM).toBeGreaterThanOrEqual(4 * 1024);
		const bytes = await backendBytes(pluginDir);
		expect(
			bytes,
			`backend.js is ${kib(bytes)}, budget ${kib(EVENTS_BUNDLE_BUDGET)} less ${kib(EVENTS_HOTFIX_ROOM)} of hotfix room`,
		).toBeLessThanOrEqual(EVENTS_BUNDLE_BUDGET - EVENTS_HOTFIX_ROOM);
	});
});
