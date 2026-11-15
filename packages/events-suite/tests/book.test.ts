import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { bookHref, bookingTarget, wantsBooking } from "../src/astro/lib/book";
import type { VoucherView } from "../src/astro/lib/buy";

// T171: "Book with this voucher". voucher/1 §8 keeps codes out of query strings, paths and logs, except the voucher
// page's own link `/_vouchers/v?c=<code>`. So the button is that page again with `&book=1`: it puts the code in a
// short-lived HttpOnly cookie and sends the buyer (303, no referrer) to the booking form, which fills the Gift
// voucher field from the cookie on the server. An activity voucher goes to its event's form with the ticket type
// chosen; a money voucher to the site's list of activities. With nowhere to book, there is no button.

const EVENTS = "r_events1";
const ORIGIN = "https://site.example";

const view = (over: Partial<VoucherView> = {}): VoucherView => ({
	kind: "money",
	currency: "GBP",
	amountMinor: 5000,
	balanceMinor: 5000,
	usesLeft: 0,
	heldMinor: 0,
	label: null,
	status: "active",
	expiresAt: "2027-11-12T10:00:00.000Z",
	toName: "Bob",
	fromName: "Ada",
	message: null,
	...over,
});
const clay = (over: Partial<VoucherView> = {}) =>
	view({
		kind: "activity",
		amountMinor: 3500,
		balanceMinor: 0,
		usesLeft: 1,
		label: "One clay session",
		eventId: "ev_clay",
		ticketTypeId: "tt_session",
		...over,
	});

function site(events: Array<Record<string, unknown>> | null) {
	const calls: string[] = [];
	const handler = async (id: string, method: string, path: string) => {
		calls.push(`${id} ${method} ${path}`);
		if (events === null) return { success: false, error: { code: "INTERNAL", message: "down" } };
		return { success: true, data: { ok: true, events } };
	};
	return {
		calls,
		ctx: { locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url: new URL(`${ORIGIN}/_vouchers/v`) },
	};
}

const OPTS = { eventsPluginId: EVENTS, listPath: "/events" };
const LISTED = [
	{ eventId: "ev_other", slug: "other", status: "on_sale" },
	{ eventId: "ev_clay", slug: "clay-taster", status: "on_sale" },
];

describe("T171 R16 where Book with this voucher goes", () => {
	it("R16 an activity voucher: its event's page, the ticket type chosen, at the booking form", async () => {
		const { ctx, calls } = site(LISTED);
		expect(await bookingTarget(ctx, clay(), OPTS)).toBe("/events/clay-taster?ticketType=tt_session#book-ev_clay");
		expect(calls).toEqual([`${EVENTS} GET public/events`]);
	});

	it("R16 follows the site's event page path", async () => {
		const { ctx } = site(LISTED);
		expect(await bookingTarget(ctx, clay(), { ...OPTS, eventPath: "/whats-on/{slug}/" })).toBe(
			"/whats-on/clay-taster/?ticketType=tt_session#book-ev_clay",
		);
	});

	it("R16 a money voucher: the site's list of activities, Events not asked", async () => {
		const { ctx, calls } = site(LISTED);
		expect(await bookingTarget(ctx, view(), { ...OPTS, listPath: "/whats-on" })).toBe("/whats-on");
		expect(calls).toEqual([]);
	});

	it("R16 no button for an event Events does not list, has no slug or is not on sale (ids Vouchers never checks)", async () => {
		expect(await bookingTarget(site(LISTED).ctx, clay({ eventId: "ev_made_up" }), OPTS)).toBeNull();
		expect(await bookingTarget(site([{ eventId: "ev_clay", status: "on_sale" }]).ctx, clay(), OPTS)).toBeNull();
		expect(
			await bookingTarget(site([{ eventId: "ev_clay", slug: "clay-taster", status: "closed" }]).ctx, clay(), OPTS),
		).toBeNull();
		expect(await bookingTarget(site(null).ctx, clay(), OPTS)).toBeNull();
		// A Vouchers build that does not say which event (before T171) gets no button either.
		expect(await bookingTarget(site(LISTED).ctx, clay({ eventId: undefined, ticketTypeId: undefined }), OPTS)).toBeNull();
	});

	it("R16 no button for a voucher with nothing left to use, or not active", async () => {
		const { ctx, calls } = site(LISTED);
		expect(await bookingTarget(ctx, view({ balanceMinor: 0 }), OPTS)).toBeNull();
		expect(await bookingTarget(ctx, clay({ usesLeft: 0 }), OPTS)).toBeNull();
		expect(await bookingTarget(ctx, view({ status: "void" }), OPTS)).toBeNull();
		expect(await bookingTarget(ctx, view({ status: "expired" }), OPTS)).toBeNull();
		expect(calls).toEqual([]);
	});
});

describe("T171 R16 the button's link is the voucher page's own (voucher/1 §8)", () => {
	it("R16 /_vouchers/v?c=<code>&book=1", () => {
		expect(bookHref("ABCD-0123-EFGH-4567")).toBe("/_vouchers/v?c=ABCD-0123-EFGH-4567&book=1");
		expect(wantsBooking(new URL(`${ORIGIN}/_vouchers/v?c=X&book=1`))).toBe(true);
		expect(wantsBooking(new URL(`${ORIGIN}/_vouchers/v?c=X`))).toBe(false);
	});
});

const source = (file: string) =>
	readFileSync(fileURLToPath(new URL(`../src/astro/${file}`, import.meta.url)), "utf8");

describe("T171 the voucher page", () => {
	const page = source("VoucherPage.astro");

	it("R16 shows the button only when there is somewhere to book, else the how-to-use line as before", () => {
		expect(page).toContain("bookingTarget(");
		expect(page).toContain('data-testid="voucher-book"');
		expect(page).toContain("Enter the code in the Gift voucher field when you book.");
	});

	it("R16 &book=1 sets the cookie and redirects with no referrer and no caching", () => {
		expect(page).toContain("wantsBooking(Astro.url)");
		expect(page).toMatch(/Astro\.cookies\.set\(VOUCHER_COOKIE, loaded\.display, voucherCookieOptions\(Astro\.url\)\)/);
		expect(page).toMatch(/status: 303/);
		expect(page).toMatch(/"Referrer-Policy": "no-referrer"/);
	});
});

describe("T171 <BookingWithWaiver>", () => {
	const form = source("BookingWithWaiver.astro");

	it("R16 fills the Gift voucher field from the cookie and links to it", () => {
		expect(form).toContain("presetVoucher(");
		expect(form).toMatch(/value=\{presetCode \|\| undefined\}/);
		expect(form).toMatch(/href=\{`#\$\{id\}-voucher`\}/);
		expect(form).toContain("Have a gift voucher?");
	});

	it("EU-FR-04 carries the booking anchor and preselects ?ticketType=", () => {
		expect(form).toContain("id={bookAnchor(eventId)}");
		expect(form).toContain("presetTicketType(");
		expect(form).toMatch(/selected=\{t\.id === presetType \|\| undefined\}/);
	});
});
