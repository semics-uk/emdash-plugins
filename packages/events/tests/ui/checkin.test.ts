import { describe, expect, it } from "vitest";
import { checkInView, codeFromScan, safeSignLink } from "../../src/client/checkin";
import { clientMessages } from "../../src/i18n/index";

const ORIGIN = "https://hall.example";
// The page renders the screen's messages into the form (`data-messages`); the script has none of its own (T102).
const EN = clientMessages("en", "checkin.");
const AT = "2099-12-01T09:00:00.000Z";

describe("mobile check-in screen (EV-FR-11, EV-FR-12, T082)", () => {
	it("EV-FR-11 a successful check-in is a green banner with the attendee's name", () => {
		expect(checkInView(200, { ok: true, checkedIn: true, name: "Ada", checkedInAt: AT }, ORIGIN, EN)).toMatchObject({
			tone: "ok",
			title: "Checked in: Ada",
		});
	});

	it("EV-FR-11 a second scan warns with the first time", () => {
		const view = checkInView(
			200,
			{ ok: true, checkedIn: false, reason: "ALREADY_CHECKED_IN", name: "Ada", checkedInAt: AT },
			ORIGIN,
			EN,
		);
		expect(view.tone).toBe("warn");
		expect(view.title).toBe("Already checked in");
		expect(view.message).toContain("Ada");
	});

	it("T049 a booking that is not confirmed is refused and says its status", () => {
		const view = checkInView(
			200,
			{ ok: true, checkedIn: false, reason: "BOOKING_NOT_CONFIRMED", name: "Ada", bookingStatus: "cancelled" },
			ORIGIN,
			EN,
		);
		expect(view).toMatchObject({ tone: "error", title: "Cannot check in" });
		expect(view.message).toContain("cancelled");
		expect(view.signLink).toBeUndefined();
	});

	it("EV-FR-12 a pending waiver shows the sign link", () => {
		const signLink = `${ORIGIN}/_events/sign#intent=abc.def&lookup=ghi`;
		const view = checkInView(
			200,
			{ ok: true, checkedIn: false, reason: "WAIVER_PENDING", name: "Charles", signLink },
			ORIGIN,
			EN,
		);
		expect(view).toMatchObject({ tone: "error", title: "Waiver not signed", signLink });
		expect(view.message).toContain("Charles");
	});

	it("EV-FR-12 only this site's door signing page is ever linked", () => {
		expect(safeSignLink(`${ORIGIN}/_events/sign#intent=a`, ORIGIN)).toBe(`${ORIGIN}/_events/sign#intent=a`);
		for (const bad of [
			"javascript:alert(1)",
			"https://evil.example/_events/sign#intent=a",
			`${ORIGIN}/booking#intent=a`,
			`${ORIGIN.replace("https", "http")}/_events/sign#intent=a`,
			42,
			undefined,
		]) {
			expect(safeSignLink(bad, ORIGIN), String(bad)).toBeUndefined();
		}
	});

	it("EV-FR-11 says what to do when the route is missing (Free), signed out, or unlicensed", () => {
		expect(checkInView(404, { error: { code: "NOT_FOUND" } }, ORIGIN, EN).message).toContain("Events Pro");
		expect(checkInView(401, null, ORIGIN, EN).message).toContain("Sign in");
		expect(checkInView(403, null, ORIGIN, EN).message).toContain("Sign in");
		expect(checkInView(200, { ok: false, error: { code: "LICENCE_INVALID" } }, ORIGIN, EN).message).toContain(
			"licence",
		);
		expect(checkInView(200, { ok: true, checkedIn: false, reason: "NOT_FOUND" }, ORIGIN, EN).title).toBe(
			"Code not found",
		);
		expect(checkInView(500, "oops", ORIGIN, EN).tone).toBe("error");
	});

	it("EV-FR-11 a scanned or typed code is trimmed and capped", () => {
		expect(codeFromScan("  abc_DEF-123 \n")).toBe("abc_DEF-123");
		expect(codeFromScan("x".repeat(500))).toHaveLength(200);
	});
});
