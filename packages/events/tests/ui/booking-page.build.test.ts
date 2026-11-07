import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// What the booking page's components wire up (read from source: the node project, no workerd file system).

const read = (name: string) => readFileSync(fileURLToPath(new URL(`../../src/astro/${name}`, import.meta.url)), "utf8");

describe("booking page", () => {
	const page = read("BookingPage.astro");

	it("carries the stylesheet, the site's stylesheet and brand", () => {
		expect(page).toContain("set:html={pageCss(page)}");
		expect(page).toContain("{page.stylesheet && <link");
		expect(page).toContain('<body class="semics-page">');
		expect(page).toContain("<PageBrand brand={page.brand} />");
	});

	it("gives times in the event's zone, on every block", () => {
		expect(page).toContain("zone={booking.event?.timezone}");
		expect(read("BookingStatus.astro")).toContain("zonedAt(iso, booking.event?.timezone, locale)");
		expect(read("AttendeeList.astro")).toContain("zonedAt(iso, zone, locale)");
	});

	it("EU-FR-09 links a lapsed booking back to its event", () => {
		expect(read("BookingStatus.astro")).toContain('status === "expired" && bookAgain');
		expect(page).toContain("bookAgain={eventPageHref(booking.event?.slug, page.eventPath)}");
	});

	it("EV-FR-07 shows a hold past its deadline as lapsed, after reconciling", () => {
		expect(page.indexOf("asOfNow(booking, Date.now())")).toBeGreaterThan(page.indexOf("reconcileWanted(booking)"));
	});

	it("forgets what the booking form kept", () => {
		expect(page).toContain('import "../client/forget-form.ts"');
	});

	it("T133 says what to do when an invitation does not arrive", () => {
		expect(read("AttendeeList.astro")).toContain('rows.some((r) => r.canResend) && <p class="semics-attendee-note"');
	});
});
