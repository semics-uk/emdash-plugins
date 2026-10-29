import { describe, expect, it } from "vitest";
import { STATUS_LABELS, statusLabel } from "../../src/astro/lib/widget";
import { t } from "../../src/i18n/index";

// The booking page for a request that waits for the organiser (T131, R95).

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
