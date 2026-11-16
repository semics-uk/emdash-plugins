import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readWaiverForm, seatField } from "../src/astro/lib/form";
import { addonCap } from "../src/astro/lib/rows";

// T174d: per-person add-ons (Events Pro marks the types in `public/event`) in <BookingWithWaiver>. They are listed under
// the tickets or attendees as quantities (`addon:<id>`), not as attendee rows or ticket choices; the post adds them as
// lines; with JavaScript each is capped live by the places chosen, and without it Events Pro's reserve refuses more.

const source = readFileSync(fileURLToPath(new URL("../src/astro/BookingWithWaiver.astro", import.meta.url)), "utf8");

function form(fields: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
}
const BASE = { eventId: "ev_1", name: "Ada Lovelace", email: "ada@example.com", idempotencyKey: "k".repeat(43) };

describe("T174d add-ons in the booking form", () => {
	it("T174d a plain order posts its add-ons as lines after the places; none chosen adds nothing", () => {
		const read = readWaiverForm(form({ ...BASE, plain: "1", ticketTypeId: "tt_p", qty: "4", "addon:tt_q": "4" }));
		expect(read.ok && read.order.lines).toEqual([
			{ ticketTypeId: "tt_p", qty: 4 },
			{ ticketTypeId: "tt_q", qty: 4 },
		]);
		expect(read.ok && read.order.attendees).toEqual([]);
		const none = readWaiverForm(form({ ...BASE, plain: "1", ticketTypeId: "tt_p", qty: "2", "addon:tt_q": "0" }));
		expect(none.ok && none.order.lines).toEqual([{ ticketTypeId: "tt_p", qty: 2 }]);
	});

	it("T174d attendee rows stay the places: add-ons are lines without attendees", () => {
		const read = readWaiverForm(
			form({
				...BASE,
				[seatField(1, "ticketTypeId")]: "tt_p",
				[seatField(1, "name")]: "Ada Lovelace",
				[seatField(2, "ticketTypeId")]: "tt_p",
				[seatField(2, "name")]: "Byron Lovelace",
				[seatField(2, "minor")]: "on",
				"addon:tt_q": "2",
			}),
		);
		expect(read.ok && read.order.lines).toEqual([
			{ ticketTypeId: "tt_p", qty: 2 },
			{ ticketTypeId: "tt_q", qty: 2 },
		]);
		expect(read.ok && read.order.attendees.map((a) => a.ticketTypeId)).toEqual(["tt_p", "tt_p"]);
	});

	it("T174d a quantity that is not a whole number from 0 to 50 marks the tickets", () => {
		for (const bad of ["-1", "2.5", "51", "x"]) {
			const read = readWaiverForm(form({ ...BASE, plain: "1", ticketTypeId: "tt_p", qty: "2", "addon:tt_q": bad }));
			expect(read, bad).toMatchObject({ ok: false, fields: ["tickets"] });
		}
	});

	it("T174d the live cap: up to the places chosen, within the add-on's own limit", () => {
		expect(addonCap(4, 50)).toBe(4);
		expect(addonCap(4, 3)).toBe(3);
		expect(addonCap(0, 50)).toBe(0);
	});

	it("T174d the widget lists add-ons apart from the places it books", () => {
		expect(source).toContain('data-testid="waiver-addons"');
		expect(source).toContain("const places = ticketTypes.filter((t) => !t.addon);");
		expect(source).toMatch(/name=\{`addon:\$\{t\.id\}`\}/);
	});
});
