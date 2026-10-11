import { describe, expect, it } from "vitest";
import { sharedVersion } from "../src/index";

describe("@semics-tech/shared", () => {
	it("exports a pure function with a stable value", () => {
		expect(sharedVersion()).toBe("shared-0");
		expect(sharedVersion()).toBe(sharedVersion());
	});
});
