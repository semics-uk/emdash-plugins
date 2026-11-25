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

describe("T185 a sandboxed ctx.log is an RPC: report waits for it (rc.36 dropped unawaited lines)", () => {
	const slowLog = () => {
		const done: string[] = [];
		const later = (m: string) => new Promise<void>((resolve) => setTimeout(() => resolve(void done.push(m)), 5));
		return { done, log: { warn: later, error: later } };
	};

	it("report resolves only after the log call has", async () => {
		const { done, log } = slowLog();
		await report(log, "warn", "x.slow");
		expect(done).toEqual(["x.slow"]);
	});

	it("a log that rejects never fails the caller", async () => {
		const failing = { warn: async () => Promise.reject(new Error("bridge gone")), error: () => undefined };
		await expect(report(failing, "warn", "x")).resolves.toBeUndefined();
	});
});
