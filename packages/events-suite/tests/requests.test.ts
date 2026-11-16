import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { handleWaiverRequest, type WaiverOutcome } from "../src/astro/lib/flow";
import { readWaiverForm, seatField, WAIVER_PATH } from "../src/astro/lib/form";
import { applyFields, collectFields, type KeptField } from "../src/astro/lib/keep-form";

// T174a in <BookingWithWaiver> (LMSC staging rc.18): an event that takes booking requests (a preferred date and a
// time window, no fixed date) gets the same request mode as Events' <BookingWidget>: a select of the dates the
// event takes (Events' `requestDates`), window radios, and the post carries `request` instead of `occurrenceId`.
// The waiver flow (reserve, continue, sign) is unchanged.

const source = readFileSync(fileURLToPath(new URL("../src/astro/BookingWithWaiver.astro", import.meta.url)), "utf8");

const EVENTS = "r_events1";
const IDS = { eventsPluginId: EVENTS, esignPluginId: "r_esign1" };
const REF = "ABCDEFGHJK";
const ACCESS = "A".repeat(43);
const ORIGIN = "https://site.example";

const ok = (data: Record<string, unknown>) => ({ success: true, data: { ok: true, ...data } });
const refused = (code: string, issues?: unknown[]) => ({
	success: true,
	data: { ok: false, error: { code, message: code }, ...(issues ? { issues } : {}) },
});

function host(routes: Record<string, () => unknown>) {
	const calls: Array<{ path: string; body: Record<string, unknown> }> = [];
	const handler = async (id: string, _method: string, path: string, request: Request) => {
		const body = (await request
			.clone()
			.json()
			.catch(() => ({}))) as Record<string, unknown>;
		calls.push({ path, body });
		const respond = routes[`${id} ${path}`];
		return respond ? respond() : refused("NOT_FOUND");
	};
	return { calls, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never };
}

function run(h: ReturnType<typeof host>, fields: Record<string, string>) {
	const request = new Request(`${ORIGIN}${WAIVER_PATH}`, {
		method: "POST",
		body: new URLSearchParams(fields),
		headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" },
	});
	return handleWaiverRequest({ locals: h.locals, url: new URL(request.url), request, cookie: () => undefined }, IDS, {
		newKey: () => "n".repeat(43),
	});
}

const location = (outcome: WaiverOutcome) => {
	expect(outcome.type).toBe("redirect");
	return (outcome as Extract<WaiverOutcome, { type: "redirect" }>).location;
};

const REQUEST = {
	intent: "book",
	eventId: "ev_1",
	returnTo: "/events/trek",
	idempotencyKey: "k".repeat(43),
	name: "Ada Lovelace",
	email: "ada@example.com",
	needsRequest: "1",
	requestDate: "2026-12-12",
	requestWindow: "am",
};
const PLAIN = { ...REQUEST, plain: "1", ticketTypeId: "tt_trek", qty: "2" };
const WAIVER = {
	...REQUEST,
	waiverEach: "1",
	[seatField(1, "ticketTypeId")]: "tt_trek",
	[seatField(1, "name")]: "Ada Lovelace",
	[seatField(2, "ticketTypeId")]: "tt_trek",
	[seatField(2, "name")]: "Byron Lovelace",
	[seatField(2, "minor")]: "on",
};

const form = (fields: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
};

describe("T174a <BookingWithWaiver> reads a booking request", () => {
	it("T174a the date and window become `request`; no occurrence is asked for", () => {
		const read = readWaiverForm(form(PLAIN));
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.order.request).toEqual({ date: "2026-12-12", window: "am" });
		expect(read.order).not.toHaveProperty("occurrenceId");
	});

	it("T174a a request form without its date or its window is refused on the date field", () => {
		for (const missing of ["requestDate", "requestWindow"]) {
			const { [missing]: _gone, ...rest } = PLAIN as Record<string, string>;
			expect(readWaiverForm(form(rest))).toEqual({ ok: false, code: "BAD_REQUEST", fields: ["occurrence"] });
		}
	});

	it("T174a a form that is not in request mode sends no request, even with stray fields", () => {
		const { needsRequest: _off, ...rest } = PLAIN;
		const read = readWaiverForm(form(rest));
		expect(read.ok && read.order).not.toHaveProperty("request");
	});
});

describe("T174a the waiver flow reserves a request", () => {
	const done = () => ok({ bookingRef: REF, status: "awaiting_approval", next: { type: "done", bookingRef: REF } });

	it("T174a a plain request reserves with `request` (not `occurrenceId`) and lands on the booking page", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: () => ok({ bookingRef: REF, accessToken: ACCESS }),
			[`${EVENTS} public/checkout/continue`]: done,
		});
		expect(location(await run(h, PLAIN))).toBe(`/booking?ref=${REF}`);
		expect(h.calls[0]?.path).toBe("public/checkout/reserve");
		expect(h.calls[0]?.body).toMatchObject({
			eventId: "ev_1",
			request: { date: "2026-12-12", window: "am" },
			lines: [{ ticketTypeId: "tt_trek", qty: 2 }],
		});
		expect(h.calls[0]?.body).not.toHaveProperty("occurrenceId");
	});

	it("T174a a waiver request keeps the attendee rows and the signing step", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: () => ok({ bookingRef: REF, accessToken: ACCESS }),
			[`${EVENTS} public/checkout/continue`]: done,
		});
		expect(location(await run(h, WAIVER))).toBe(`/booking?ref=${REF}`);
		expect(h.calls[0]?.body).toMatchObject({
			request: { date: "2026-12-12", window: "am" },
			lines: [{ ticketTypeId: "tt_trek", qty: 2 }],
		});
		expect(h.calls[1]?.body).toMatchObject({
			attendees: [
				{ ticketTypeId: "tt_trek", name: "Ada Lovelace" },
				{ ticketTypeId: "tt_trek", name: "Byron Lovelace", minor: true },
			],
		});
	});

	it("T174a a request the core refuses (a closed date, say) comes back on the date field", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: () => refused("BAD_REQUEST", [{ path: "request", code: "REQUEST_DATE" }]),
		});
		const back = location(await run(h, PLAIN));
		expect(back).toContain("waiver_error=BAD_REQUEST");
		expect(back).toContain("waiver_fields=occurrence");
	});
});

describe("T174a the request mode markup", () => {
	it("T174a lists the dates with Events' requestDates (not a copy) and the windows as radios", () => {
		expect(source).toMatch(
			/import \{[^}]*\brequestDates\b[^}]*\} from "@semics-tech\/emdash-events\/astro\/lib\/widget"/,
		);
		expect(source).toContain("requestDates(requests, zone, Date.now(), locale)");
		expect(source).toContain('<input type="hidden" name="needsRequest" value="1" />');
		expect(source).toMatch(/<select[^>]*name="requestDate"/);
		expect(source).toMatch(/<input[^>]*type="radio" name="requestWindow"/);
		expect(source).toContain('data-testid="booking-windows"');
	});
});

describe("T174a keep-form keeps the chosen window", () => {
	const radio = (value: string, checked: boolean): KeptField => ({
		name: "requestWindow",
		type: "radio",
		value,
		checked,
	});

	it("T174a keeps only the checked radio, and checks it again without changing any radio's value", () => {
		expect(collectFields([radio("am", true), radio("pm", false)])).toEqual({ requestWindow: "am" });
		expect(collectFields([radio("am", false), radio("pm", false)])).toEqual({});
		const blank = [radio("am", false), radio("pm", false)];
		applyFields(blank, { requestWindow: "pm" });
		expect(blank.map((r) => [r.value, r.checked])).toEqual([
			["am", false],
			["pm", true],
		]);
	});
});

// T174e: attendees after approval. A waiver event that takes requests books by ticket type and quantity (the plain
// group, no attendee rows and no seat rules), and says the names come after staff confirm the time. Without
// JavaScript it is the same plain form. Events Pro signs the waiver after approval and names the seats then.
describe("T174e a waiver request skips the attendee rows", () => {
	it("T174e the rows and the seat check are only for a waiver event that is not a request", () => {
		expect(source).toContain("const later = needsWaiver && Boolean(requests);");
		expect(source).toContain(
			"const rows = needsWaiver && !later ? Array.from({ length: seats }, (_, i) => i + 1) : [];",
		);
		expect(source).toContain('{data?.waiverEach && !later && <input type="hidden" name="waiverEach" value="1" />}');
		expect(source).toContain("{(!needsWaiver || later) && (");
		expect(source).toContain('data-testid="waiver-later"');
		expect(source).toMatch(/names and emails/);
	});

	it("T174e the plain request posts no attendees, so Events Pro leaves them for after approval", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: () => ok({ bookingRef: REF, accessToken: ACCESS }),
			[`${EVENTS} public/checkout/continue`]: () =>
				ok({
					bookingRef: REF,
					status: "awaiting_payment",
					next: { type: "pay", url: "https://checkout.stripe.com/c/pay/x" },
				}),
		});
		expect(location(await run(h, PLAIN))).toBe("https://checkout.stripe.com/c/pay/x");
		expect(h.calls[1]?.path).toBe("public/checkout/continue");
		expect(h.calls[1]?.body).not.toHaveProperty("attendees");
	});
});
