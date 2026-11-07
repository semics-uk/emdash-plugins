import { describe, expect, it } from "vitest";
import { endedNotes, STATUS_LABELS, statusLabel } from "../../src/astro/lib/widget";
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
