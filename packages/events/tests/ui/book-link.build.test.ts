import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	bookAnchor,
	presetTicketType,
	presetVoucher,
	TICKET_TYPE_PARAM,
	VOUCHER_COOKIE,
	VOUCHER_COOKIE_SECONDS,
	voucherCookieOptions,
} from "../../src/astro/lib/book-link";
import { translator } from "../../src/i18n/index";

// T171: "Book with this voucher". The voucher page (the suite's `/_vouchers/v?c=…&book=1`) puts the code in a
// short-lived HttpOnly cookie and sends the buyer to the event's booking form; the form fills its Gift voucher
// field from that cookie on the server, so the code never travels in a booking URL (voucher/1 §8).
const source = (file: string) =>
	readFileSync(fileURLToPath(new URL(`../../src/astro/${file}`, import.meta.url)), "utf8");

const jar = (values: Record<string, string>) => ({
	get: (name: string) => (name in values ? { value: values[name] as string } : undefined),
});

describe("T171 the voucher cookie", () => {
	it("R16 is HttpOnly, SameSite=Lax, the whole site, Secure on https, 30 minutes", () => {
		expect(VOUCHER_COOKIE).toBe("semics_voucher");
		expect(VOUCHER_COOKIE_SECONDS).toBe(1800);
		expect(voucherCookieOptions(new URL("https://site.example/x"))).toEqual({
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			secure: true,
			maxAge: 1800,
		});
		expect(voucherCookieOptions(new URL("http://localhost:4321/")).secure).toBe(false);
	});

	it("R16 fills the field only with a well-formed display code", () => {
		expect(presetVoucher(jar({ semics_voucher: "ABCD-0123-EFGH-4567" }))).toBe("ABCD-0123-EFGH-4567");
		expect(presetVoucher(jar({}))).toBe("");
		expect(presetVoucher(jar({ semics_voucher: "<script>" }))).toBe("");
		expect(presetVoucher(jar({ semics_voucher: "ABCD0123EFGH4567" }))).toBe("");
		expect(presetVoucher(undefined)).toBe("");
		// A prerendered page has no cookies: Astro throws.
		expect(
			presetVoucher({
				get: () => {
					throw new Error("no cookies");
				},
			}),
		).toBe("");
	});
});

describe("T171 ?ticketType= and the booking anchor", () => {
	it("EU-FR-04 preselects a ticket type the form offers, nothing else", () => {
		expect(TICKET_TYPE_PARAM).toBe("ticketType");
		const url = (q: string) => new URL(`https://site.example/events/clay?${q}`);
		expect(presetTicketType(url("ticketType=tt_1"), ["tt_1", "tt_2"])).toBe("tt_1");
		expect(presetTicketType(url("ticketType=tt_9"), ["tt_1", "tt_2"])).toBeUndefined();
		expect(presetTicketType(url(""), ["tt_1"])).toBeUndefined();
	});

	it("EU-FR-04 one anchor per event for both booking forms", () => {
		expect(bookAnchor("ev 1/x")).toBe("book-ev_1_x");
	});
});

describe("T171 the widget", () => {
	const widget = source("BookingWidget.astro");

	it("R16 fills the Gift voucher field from the cookie and links to it: Have a voucher?", () => {
		expect(widget).toContain("presetVoucher(");
		expect(widget).toMatch(/value=\{presetCode \|\| undefined\}/);
		expect(widget).toMatch(/href=\{`#\$\{id\}-voucher`\}/);
		expect(translator("en").t("widget.voucher.have")).toBe("Have a gift voucher?");
		expect(translator("ar").t("widget.voucher.have")).not.toBe("widget.voucher.have");
	});

	it("EU-FR-04 the form carries the booking anchor and preselects ?ticketType= with one ticket", () => {
		expect(widget).toContain("id={bookAnchor(eventId)}");
		expect(widget).toContain("presetTicketType(");
		expect(widget).toMatch(/value=\{type\.id === presetType \? "1" : "0"\}/);
	});

	it("R16 a page that filled a code from the cookie is not cached", () => {
		expect(widget).toContain('"private, no-store"');
	});
});

describe("T171 the booking page forgets the code once a booking used it", () => {
	it("R16 deletes the voucher cookie when the booking carries a voucher", () => {
		const page = source("BookingPage.astro");
		expect(page).toContain("VOUCHER_COOKIE");
		expect(page).toMatch(/cookies\.delete\(VOUCHER_COOKIE/);
	});
});
