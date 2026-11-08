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
		expect(read("BookingStatus.astro")).toContain("const zone = booking.event?.timezone;");
		expect(read("BookingStatus.astro")).toContain("zonedAt(iso, zone, locale)");
		expect(read("CancelBooking.astro")).toContain("zonedAt(cancelBy, zone, locale)");
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

	it("T157 leads with the event, the booked session in its zone, and the place", () => {
		const status = read("BookingStatus.astro");
		const order = [
			'data-testid="booking-event"',
			'data-testid="booking-when"',
			'data-testid="booking-venue"',
			'data-testid="booking-ref"',
		];
		const at = order.map((s) => status.indexOf(s));
		expect(at.every((i) => i > 0)).toBe(true);
		expect([...at].sort((a, b) => a - b)).toEqual(at);
		expect(status).toContain("const at = (iso: string) => zonedAt(iso, zone, locale);");
	});

	it("T157 offers Print or save as PDF on a confirmed booking, wired by a script, and the organiser at the foot", () => {
		expect(page).toMatch(
			/<button type="button" class="semics-print" data-print[^>]* hidden>\{t\("booking.print"\)\}<\/button>/,
		);
		expect(page).toContain('import "../client/print.ts"');
		expect(page).toContain("<PageOrganiser brand={page.brand} locale={locale} />");
	});

	it("T157 puts Cancel booking at the foot, behind a confirmation", () => {
		expect(page).not.toContain("cancelAction={");
		expect(page.indexOf("<CancelBooking")).toBeGreaterThan(page.indexOf("<TicketPass"));
		const cancel = read("CancelBooking.astro");
		expect(cancel).toMatch(/<details[^>]*>\s*<summary>\{t\("booking.cancel"\)\}<\/summary>\s*<form method="post"/);
		expect(cancel).toContain('{t("booking.cancelYes")}');
	});
});
