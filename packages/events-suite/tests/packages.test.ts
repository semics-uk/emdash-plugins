import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { readWaiverForm, seatField } from "../src/astro/lib/form";
import { orderMinor } from "../src/astro/lib/rows";

// T174f: a party package (Events Pro marks the type `package` in `public/event`) in <BookingWithWaiver>. Its people
// are the quantity (the plain "How many people?" or one attendee row each), posted as the line's quantity; Events
// plans one package for them. The summary prices the package once, whatever the party size.

const source = readFileSync(fileURLToPath(new URL("../src/astro/BookingWithWaiver.astro", import.meta.url)), "utf8");

function form(fields: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
}
const BASE = { eventId: "ev_1", name: "Ada Lovelace", email: "ada@example.com", idempotencyKey: "k".repeat(43) };

describe("T174f packages in the booking form", () => {
	it("T174f a plain package order posts its people as the quantity, with one add-on each", () => {
		const read = readWaiverForm(form({ ...BASE, plain: "1", ticketTypeId: "tt_pk", qty: "3", "addon:tt_q": "3" }));
		expect(read.ok && read.order.lines).toEqual([
			{ ticketTypeId: "tt_pk", qty: 3 },
			{ ticketTypeId: "tt_q", qty: 3 },
		]);
	});

	it("T174f attendee rows on a package are its people", () => {
		const fields: Record<string, string> = { ...BASE };
		for (const n of [1, 2, 3]) {
			fields[seatField(n, "ticketTypeId")] = "tt_pk";
			fields[seatField(n, "name")] = `Person ${n}`;
			fields[seatField(n, "email")] = `p${n}@example.com`;
		}
		const read = readWaiverForm(form(fields));
		expect(read.ok && read.order.lines).toEqual([{ ticketTypeId: "tt_pk", qty: 3 }]);
		expect(read.ok && read.order.attendees).toHaveLength(3);
	});

	it("T174f the summary prices a package once for its people and per-person types each", () => {
		expect(orderMinor([{ priceMinor: 12_000, package: true, qty: 3 }])).toBe(12_000);
		expect(
			orderMinor([
				{ priceMinor: 12_000, package: true, qty: 3 },
				{ priceMinor: 4000, qty: 2 },
			]),
		).toBe(20_000);
		expect(orderMinor([{ priceMinor: 12_000, package: true, qty: 0 }])).toBe(0);
	});

	it("T174f the widget asks how many people for a package and marks its options", () => {
		expect(source).toContain("How many people?");
		expect(source).toContain("data-package=");
	});
});
