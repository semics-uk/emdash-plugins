import { describe, expect, it } from "vitest";

import { report, scrubText } from "../src/report";

describe("T185 (#79) report: a stable code and plain values in the site's own log", () => {
	it("scrubs links, email addresses and token-like text, and caps the length", () => {
		expect(scrubText("550 ada@example.com refused, see https://x.test/a?b=c token abcdefghijklmnopqrstuvwxyz0")).toBe(
			"550 … refused, see … token …",
		);
		expect(scrubText("ab ".repeat(200), 10)).toHaveLength(10);
	});

	it("logs the code as the message and in the data, text values scrubbed, numbers kept", () => {
		const seen: unknown[] = [];
		const log = {
			warn: (...a: unknown[]) => void seen.push(["warn", ...a]),
			error: (...a: unknown[]) => void seen.push(["error", ...a]),
		};
		report(log, "error", "webhook.failed", { event: "evt_1", status: 500, to: "a@b.test" });
		expect(seen).toEqual([
			["error", "webhook.failed", { code: "webhook.failed", event: "evt_1", status: 500, to: "…" }],
		]);
		expect(() => report(undefined, "warn", "x")).not.toThrow();
	});
});
