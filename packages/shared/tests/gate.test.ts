/** T070 Pro gating (BUILD-PLAN §13 "What a key controls", R17). */
import { describe, expect, it } from "vitest";
import { err, gateProOperation, gateProWork, type LicenceResult, ok, PRO_OPERATIONS } from "../src/index";

const licensed: LicenceResult = ok({
	kind: "licensed",
	hostname: "example.com",
	licence: {
		v: 1,
		product: "events",
		edition: "pro",
		sites: ["example.com"],
		customer: "cus_123",
		issuedAt: "2026-10-01",
		updatesUntil: "2027-10-01",
	},
});
const exempt: LicenceResult = ok({ kind: "exempt", hostname: "localhost" });
const invalid: LicenceResult = err("LICENCE_INVALID");
const expired: LicenceResult = err("LICENCE_EXPIRED");

describe("R17 Pro gate: no new paid work without a key, in-flight work continues", () => {
	it("blocks a new paid checkout without a valid key but allows refunds", () => {
		expect(gateProOperation(invalid, "events/checkout")).toEqual({ ok: false, error: "LICENCE_INVALID" });
		expect(gateProOperation(expired, "events/checkout")).toEqual({ ok: false, error: "LICENCE_EXPIRED" });
		expect(gateProOperation(invalid, "events/refund")).toEqual({ ok: true, value: true });
		expect(gateProOperation(expired, "events/refund")).toEqual({ ok: true, value: true });
	});

	it("allows new paid work with a valid key or on an exempt host", () => {
		expect(gateProOperation(licensed, "events/checkout")).toEqual({ ok: true, value: true });
		expect(gateProOperation(exempt, "events/checkout")).toEqual({ ok: true, value: true });
	});

	it("classifies every listed operation as new or in-flight work", () => {
		for (const [operation, work] of Object.entries(PRO_OPERATIONS)) {
			expect(["new", "in-flight"]).toContain(work);
			expect(gateProOperation(invalid, operation as keyof typeof PRO_OPERATIONS).ok, operation).toBe(
				work === "in-flight",
			);
		}
		expect(PRO_OPERATIONS["events/refund"]).toBe("in-flight");
		expect(PRO_OPERATIONS["events/checkout"]).toBe("new");
		expect(Object.isFrozen(PRO_OPERATIONS)).toBe(true);
	});

	it("gates raw work kinds the same way", () => {
		expect(gateProWork(invalid, "new").ok).toBe(false);
		expect(gateProWork(invalid, "in-flight").ok).toBe(true);
		expect(gateProWork(licensed, "new").ok).toBe(true);
	});
});
