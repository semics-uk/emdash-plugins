import { describe, expect, it } from "vitest";
import { paymentView } from "../../src/astro/lib/payment";
import { asOfNow, endedNotes, STATUS_LABELS, statusLabel } from "../../src/astro/lib/widget";
import { t } from "../../src/i18n/index";

// The booking page for a request that waits for the organiser (T131, R97).

describe("what the page says about a booking that ended", () => {
	it("T131 a decline shows the organiser's reason, as given", () => {
		expect(endedNotes({ status: "declined", declineReason: "Fully <b>booked" }, "en")).toEqual([
			"The organiser's reason: Fully <b>booked",
		]);
	});

	it("T132 says the card was not charged only when the booking says so", () => {
		const note = "Your card was not charged.";
		expect(endedNotes({ status: "declined", notCharged: true }, "en")).toEqual([note]);
		expect(endedNotes({ status: "declined", notCharged: false }, "en")).toEqual([]);
		expect(endedNotes({ status: "declined" }, "en")).toEqual([]);
		expect(endedNotes({ status: "confirmed", notCharged: true }, "en")).toEqual([]);
		expect(endedNotes({ status: "declined", notCharged: true }, "ar")).not.toEqual([note]);
	});

	it("EU-FR-09 a booking that lapsed says so and how to start again", () => {
		const [note] = endedNotes({ status: "expired" }, "en");
		expect(note).toContain("lapsed");
		expect(note).toContain("start a new booking");
		expect(note).toContain("sign it again");
	});

	it("T131 a request the organiser never decided says that, and makes no claim about a payment", () => {
		const b = { status: "expired", undecided: true, totals: { totalMinor: 4000, currency: "GBP" } };
		const [note] = endedNotes(b, "en");
		expect(note).toContain("did not decide");
		expect(note).not.toContain("not finished in time");
		expect(paymentView({ ...b, bookingRef: "R", lines: [], attendees: [], canCancel: false }, "en")).toBeNull();
	});

	it("EU-FR-09 a paid booking that lapsed does not repeat the payment section's message", () => {
		const b = { status: "expired", totals: { totalMinor: 4000, currency: "GBP" } };
		expect(endedNotes(b, "en")).toEqual(["If there is a waiver, you will sign it again when you book."]);
		expect(paymentView({ ...b, bookingRef: "R", lines: [], attendees: [], canCancel: false }, "en")?.heading).toBe(
			"This booking expired",
		);
	});
});

describe("a hold past its deadline", () => {
	const hold = { status: "awaiting_payment", holdExpiresAt: "2026-11-09T15:00:00.000Z", canCancel: true };
	const at = (iso: string) => Date.parse(iso);

	it("EV-FR-07 reads as expired from the deadline on, before the sweeper moves it", () => {
		const late = asOfNow(hold, at("2026-11-09T15:00:00.000Z"));
		expect(late.status).toBe("expired");
		expect(late.canCancel).toBe(false);
		expect(late.holdExpiresAt).toBeUndefined();
	});

	it("EV-FR-07 stays as it is before then, and without a deadline", () => {
		expect(asOfNow(hold, at("2026-11-09T14:59:59.000Z"))).toBe(hold);
		const confirmed = { status: "confirmed", canCancel: true };
		expect(asOfNow(confirmed, at("2030-01-01T00:00:00.000Z"))).toBe(confirmed);
	});
});

describe("T131 booking page status", () => {
	it("T131 shows 'Awaiting approval' and 'Declined', translated", () => {
		expect(statusLabel("awaiting_approval", "en")).toBe("Awaiting approval");
		expect(statusLabel("declined", "en")).toBe("Declined");
		expect(STATUS_LABELS.awaiting_approval).toBe("Awaiting approval");
		expect(statusLabel("awaiting_approval", "ar")).not.toBe("Awaiting approval");
	});

	it("T131 says by when the organiser decides", () => {
		expect(t("en", "booking.decideBy", { time: "1 Nov" })).toContain("1 Nov");
	});
});
