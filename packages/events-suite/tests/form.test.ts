import { describe, expect, it } from "vitest";

import {
	hasControlCharacters,
	MAX_SEATS,
	readWaiverForm,
	readWaiverState,
	seatField,
	WAIVER_PARAMS,
	waiverErrorLocation,
} from "../src/astro/lib/form";

// The booking half of <BookingWithWaiver> (SX-FR-02): one row per attendee with an "under 18"
// control, checked before anything is reserved. E-sign refuses a name with a C0 control character
// or DEL (esign-intent/1 §5 `name`), so such a name is refused here, before any intent exists.

function form(fields: Record<string, string>): FormData {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
}

const BASE = { eventId: "ev_1", name: "Ada Lovelace", email: "ada@example.com", idempotencyKey: "k".repeat(43) };

describe("readWaiverForm (SX-FR-02)", () => {
	it("SX-FR-02 one attendee per filled row; lines are counted per ticket type; under 18 is kept", () => {
		const read = readWaiverForm(
			form({
				...BASE,
				[seatField(1, "ticketTypeId")]: "tt_adult",
				[seatField(1, "name")]: "Ada Lovelace",
				[seatField(2, "ticketTypeId")]: "tt_child",
				[seatField(2, "name")]: "Byron Lovelace",
				[seatField(2, "minor")]: "on",
				[seatField(3, "ticketTypeId")]: "tt_adult",
				[seatField(3, "name")]: " Grace Hopper ",
				[seatField(3, "email")]: "grace@example.com",
				[seatField(4, "ticketTypeId")]: "tt_adult",
			}),
		);
		expect(read).toEqual({
			ok: true,
			order: {
				eventId: "ev_1",
				buyer: { name: "Ada Lovelace", email: "ada@example.com" },
				idempotencyKey: BASE.idempotencyKey,
				lines: [
					{ ticketTypeId: "tt_adult", qty: 2 },
					{ ticketTypeId: "tt_child", qty: 1 },
				],
				attendees: [
					{ ticketTypeId: "tt_adult", name: "Ada Lovelace" },
					{ ticketTypeId: "tt_child", name: "Byron Lovelace", minor: true },
					{ ticketTypeId: "tt_adult", name: "Grace Hopper", email: "grace@example.com" },
				],
				rows: [1, 2, 3],
			},
		});
	});

	it("SX-FR-02 keeps the date, the Turnstile answer and the return page", () => {
		const read = readWaiverForm(
			form({
				...BASE,
				needsOccurrence: "1",
				occurrenceId: "oc_1",
				"cf-turnstile-response": "ts-answer",
				[seatField(1, "ticketTypeId")]: "tt_adult",
				[seatField(1, "name")]: "Ada",
			}),
		);
		expect(read.ok && read.order).toMatchObject({ occurrenceId: "oc_1", turnstileToken: "ts-answer" });
	});

	it("SX-FR-02 a C0 control character or DEL in any attendee name is refused before booking", () => {
		for (const bad of ["Ada\u0000", "Ada\tLovelace", "Ada\u001bL", "Ada\u007f", "A\nB"]) {
			const read = readWaiverForm(
				form({
					...BASE,
					[seatField(1, "ticketTypeId")]: "tt_adult",
					[seatField(1, "name")]: "Ada",
					[seatField(2, "ticketTypeId")]: "tt_adult",
					[seatField(2, "name")]: bad,
				}),
			);
			expect(read, JSON.stringify(bad)).toEqual({
				ok: false,
				code: "CONTROL_CHARACTERS",
				fields: [seatField(2, "name")],
			});
		}
	});

	it("SX-FR-02 the buyer's name and every email are checked for control characters too", () => {
		const read = readWaiverForm(
			form({
				...BASE,
				name: "Ada\u0007",
				[seatField(1, "ticketTypeId")]: "tt_adult",
				[seatField(1, "name")]: "Grace",
				[seatField(1, "email")]: "gr\u0001ace@example.com",
			}),
		);
		expect(read).toEqual({ ok: false, code: "CONTROL_CHARACTERS", fields: ["name", seatField(1, "email")] });
	});

	it("SX-FR-02 lists the fields to fix: no attendee, a row without a name, bad emails, no date", () => {
		expect(readWaiverForm(form({ ...BASE }))).toEqual({ ok: false, code: "BAD_REQUEST", fields: ["attendees"] });
		expect(
			readWaiverForm(
				form({
					...BASE,
					email: "nope",
					needsOccurrence: "1",
					[seatField(1, "ticketTypeId")]: "tt_adult",
					[seatField(1, "minor")]: "on",
					[seatField(2, "ticketTypeId")]: "",
					[seatField(2, "name")]: "Grace",
					[seatField(2, "email")]: "grace@",
				}),
			),
		).toEqual({
			ok: false,
			code: "BAD_REQUEST",
			fields: ["occurrence", "email", seatField(1, "name"), seatField(2, "ticketTypeId"), seatField(2, "email")],
		});
		expect(readWaiverForm(form({ ...BASE, eventId: "" }))).toMatchObject({ ok: false, fields: ["event", "attendees"] });
	});

	it("SX-FR-02 reads at most MAX_SEATS rows", () => {
		const fields: Record<string, string> = { ...BASE };
		for (let i = 1; i <= MAX_SEATS + 2; i++) {
			fields[seatField(i, "ticketTypeId")] = "tt_adult";
			fields[seatField(i, "name")] = `Person ${i}`;
		}
		const read = readWaiverForm(form(fields));
		expect(read.ok && read.order.attendees.length).toBe(MAX_SEATS);
	});

	it("SX-FR-02 hasControlCharacters is the protocol's rule: C0 and U+007F only", () => {
		expect(hasControlCharacters("Zoë O'Brien-Łukasz 李")).toBe(false);
		expect(hasControlCharacters("\u0085 next line")).toBe(false);
		expect(hasControlCharacters("\u001f")).toBe(true);
		expect(hasControlCharacters("\u007f")).toBe(true);
	});
});

describe("widget error round trip (SX-FR-02)", () => {
	it("SX-FR-02 a refusal goes back to the widget with a code and field names, never values", () => {
		const location = waiverErrorLocation("/events/x?a=1", "ev_1", "CONTROL_CHARACTERS", [seatField(2, "name")]);
		const url = new URL(location, "https://site.example");
		expect(url.pathname).toBe("/events/x");
		expect(url.searchParams.get("a")).toBe("1");
		expect(url.searchParams.get(WAIVER_PARAMS.error)).toBe("CONTROL_CHARACTERS");
		expect(url.searchParams.get(WAIVER_PARAMS.fields)).toBe("attendee.2.name");
		expect(url.searchParams.get(WAIVER_PARAMS.event)).toBe("ev_1");
		expect(url.hash).toMatch(/^#semics-waiver-/);

		expect(readWaiverState(url, "ev_1")).toEqual({ code: "CONTROL_CHARACTERS", fields: ["attendee.2.name"] });
		expect(readWaiverState(url, "ev_2")).toEqual({ fields: [] });
	});

	it("SX-FR-02 unknown codes and field names from the URL are not echoed", () => {
		const url = new URL("https://site.example/x?waiver_error=<script>&waiver_fields=name,evil,attendee.99.name&waiver_event=ev_1");
		expect(readWaiverState(url, "ev_1")).toEqual({ code: "INTERNAL", fields: ["name"] });
	});
});
