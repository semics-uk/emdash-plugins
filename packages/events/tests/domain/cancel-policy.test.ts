import { describe, expect, it } from "vitest";

import { cancelCutoffHours, cancelDecision, referenceStart } from "../../src/domain/cancel-policy";

const START = "2026-11-03T12:00:00.000Z";
const T = Date.parse(START);
const HOUR = 3_600_000;
const config = {
	catalog: { ticketTypes: {}, occurrences: { oc1: { capacity: 1, startsAt: START, status: "open" as const } } },
};

describe("cancel policy (EV-US-4)", () => {
	it("EV-US-4 clamps the cutoff setting and defaults to 24 hours", () => {
		expect(cancelCutoffHours({})).toBe(24);
		expect(cancelCutoffHours({ cancelCutoffHours: -5 })).toBe(0);
		expect(cancelCutoffHours({ cancelCutoffHours: 9999 })).toBe(720);
		expect(cancelCutoffHours({ cancelCutoffHours: "x" })).toBe(24);
	});

	it("EV-US-4 the start is the occurrence's, else the config's salesEnd for an event without occurrences", () => {
		expect(referenceStart({ occurrenceId: "oc1" }, config)).toBe(T);
		expect(referenceStart({ occurrenceId: "missing" }, config)).toBeNull();
		expect(referenceStart({}, { catalog: null, salesEnd: START })).toBe(T);
		expect(referenceStart({}, null)).toBeNull();
	});

	it("EV-US-4 a confirmed booking cancels until the cutoff, inclusive", () => {
		const b = { status: "confirmed" as const, occurrenceId: "oc1" };
		expect(cancelDecision(b, config, 24, T - 24 * HOUR)).toMatchObject({ allowed: true });
		expect(cancelDecision(b, config, 24, T - 24 * HOUR + 1)).toMatchObject({ allowed: false, reason: "TOO_LATE" });
		expect(cancelDecision(b, null, 24, T)).toMatchObject({ allowed: true, cancelBy: null });
	});

	it("EV-US-4 holds can be abandoned; closed bookings cannot be cancelled", () => {
		expect(cancelDecision({ status: "held" }, null, 24, T)).toMatchObject({ allowed: true, kind: "abandon" });
		expect(cancelDecision({ status: "expired" }, null, 24, T)).toMatchObject({ allowed: false, reason: "STATUS" });
	});
});
