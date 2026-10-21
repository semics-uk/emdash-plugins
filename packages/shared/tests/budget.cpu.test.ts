import { afterEach, describe, expect, it, vi } from "vitest";
import { cpuEnforcement, expectWithinBudget } from "../testing/budget";

// The CPU figure is wall time minus bridge waits, so a loaded machine inflates it. Bridge calls are
// always strict; CPU is strict on CI or a quiet machine and only warns (up to 4x the limit) when busy.

const slow = (cpuMs: number) => ({ label: "route", invocations: [{ calls: [], cpuMs }] }) as never;

afterEach(() => vi.restoreAllMocks());

describe("T007 CPU enforcement under load", () => {
	it("is strict when SEMICS_STRICT_CPU=1, whatever the load", () => {
		expect(cpuEnforcement({ SEMICS_STRICT_CPU: "1" }, 40, 8)).toBe("strict");
	});
	it("is strict on CI", () => {
		expect(cpuEnforcement({ CI: "true" }, 40, 8)).toBe("strict");
	});
	it("is strict on a quiet machine and lenient on a busy one", () => {
		expect(cpuEnforcement({}, 2, 8)).toBe("strict");
		expect(cpuEnforcement({}, 9.5, 8)).toBe("lenient");
	});
	it("lenient mode warns instead of failing for up to 4x the CPU limit", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		expect(() => expectWithinBudget(slow(104), { cpuMs: 50 }, { enforcement: "lenient" })).not.toThrow();
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/route used CPU 104\.0 ms \(limit 50 ms\)/));
		expect(() => expectWithinBudget(slow(201), { cpuMs: 50 }, { enforcement: "lenient" })).toThrow(/CPU 201\.0 ms/);
	});
	it("strict mode fails on any CPU breach, and bridge calls are strict in both modes", () => {
		expect(() => expectWithinBudget(slow(51), { cpuMs: 50 }, { enforcement: "strict" })).toThrow(/Budget exceeded/);
		const calls = Array.from({ length: 11 }, () => ({ area: "kv", op: "get", args: [] }));
		expect(() =>
			expectWithinBudget({ invocations: [{ calls, cpuMs: 1 }] } as never, { calls: 10 }, { enforcement: "lenient" }),
		).toThrow(/11 bridge calls/);
	});
});
