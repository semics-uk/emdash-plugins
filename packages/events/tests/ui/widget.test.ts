import { describe, expect, it } from "vitest";

import {
	anchorId,
	bookingCalendarHref,
	eventCalendarHref,
	fieldsFromIssues,
	IDEMPOTENCY_KEY_PATTERN,
	newIdempotencyKey,
	readWidgetState,
	safeReturnTo,
	ticketNames,
	validateCheckoutFields,
	widgetErrorLocation,
} from "../../src/astro/lib/widget";

const origin = "https://site.example";
const NOW = Date.parse("2030-01-01T00:00:00Z");

describe("idempotency keys (EU-FR-04)", () => {
	it("EU-FR-04 makes a fresh key of 32+ URL-safe characters for each checkout attempt", () => {
		const a = newIdempotencyKey();
		const b = newIdempotencyKey();
		expect(a).toMatch(IDEMPOTENCY_KEY_PATTERN);
		expect(a.length).toBeGreaterThanOrEqual(32);
		expect(a).not.toBe(b);
		// The pattern is the one reserve accepts.
		expect("short").not.toMatch(IDEMPOTENCY_KEY_PATTERN);
		expect("a+b/c=".repeat(8)).not.toMatch(IDEMPOTENCY_KEY_PATTERN);
	});
});

describe("return paths (EU-FR-04)", () => {
	it("EU-FR-04 keeps a same-site path and drops earlier widget error parameters", () => {
		expect(safeReturnTo("/events/spring?x=1&booking_error=SOLD_OUT&booking_fields=name", origin)).toBe(
			"/events/spring?x=1",
		);
		expect(safeReturnTo("/events/spring#frag", origin)).toBe("/events/spring");
	});

	it("refuses anything that could leave the site (open redirect)", () => {
		for (const raw of [
			"",
			"https://evil.example/x",
			"//evil.example/x",
			"/\\evil.example",
			"javascript:alert(1)",
			"events",
			"/_events/checkout",
			// T119 F11: paths that resolve to `//host` (a protocol-relative URL when used as a Location).
			"/.//evil.example",
			"/%2e//evil.example",
			"/x/..//evil.example",
		]) {
			expect(safeReturnTo(raw, origin), raw).toBeUndefined();
		}
	});

	it("EU-FR-04 builds the widget error location with the code, the fields and the widget's anchor", () => {
		const loc = widgetErrorLocation("/events/spring?x=1", "ev 1", "BAD_REQUEST", ["name", "email"]);
		const parsed = new URL(loc, origin);
		expect(parsed.pathname).toBe("/events/spring");
		expect(parsed.searchParams.get("x")).toBe("1");
		expect(parsed.searchParams.get("booking_error")).toBe("BAD_REQUEST");
		expect(parsed.searchParams.get("booking_fields")).toBe("name,email");
		expect(parsed.searchParams.get("booking_event")).toBe("ev 1");
		expect(parsed.hash).toBe(`#${anchorId("ev 1")}`);
	});

	it("EU-FR-04 reads the error back only for the widget it belongs to, ignoring unknown fields", () => {
		const url = new URL(widgetErrorLocation("/e", "ev1", "BAD_REQUEST", ["email"]), origin);
		url.searchParams.set("booking_fields", "email,<script>,name");
		expect(readWidgetState(url, "ev1")).toEqual({ code: "BAD_REQUEST", fields: ["name", "email"] });
		expect(readWidgetState(url, "other")).toEqual({ fields: [] });
		const bad = new URL("/e?booking_error=%3Cb%3E&booking_event=ev1", origin);
		expect(readWidgetState(bad, "ev1")).toEqual({ code: "INTERNAL", fields: [] });
	});

	it("makes anchor ids that are safe in HTML and CSS", () => {
		expect(anchorId("ev1")).toBe("semics-booking-ev1");
		expect(anchorId('a"b<c> d')).toMatch(/^semics-booking-[A-Za-z0-9_-]+$/);
	});
});

describe("field validation and errors (EU-NFR-03)", () => {
	it("EU-NFR-03 names each field that is wrong", () => {
		expect(
			validateCheckoutFields({ name: " ", email: "nope", lines: 0, needsOccurrence: true, occurrenceId: "" }),
		).toEqual(["occurrence", "tickets", "name", "email"]);
		expect(
			validateCheckoutFields({
				name: "Ada",
				email: "ada@example.com",
				lines: 1,
				needsOccurrence: false,
				occurrenceId: "",
			}),
		).toEqual([]);
	});

	it("EU-NFR-03 maps reserve's validation issues to the widget's fields", () => {
		expect(
			fieldsFromIssues([
				{ path: "buyer.email", code: "invalid_format" },
				{ path: "buyer.name", code: "too_small" },
				{ path: "lines.0.qty", code: "too_big" },
				{ path: "occurrenceId", code: "too_small" },
				{ path: "idempotencyKey", code: "invalid_format" },
				{ path: "buyer.email", code: "again" },
			]),
		).toEqual(["email", "name", "tickets", "occurrence"]);
		expect(fieldsFromIssues(undefined)).toEqual([]);
	});
});

describe("calendar links (EU-FR-08)", () => {
	const exp = String(Math.floor(NOW / 1000) + 600);

	it("EU-FR-08 points at the core's booking ICS route with the signed query the core issued", () => {
		const href = bookingCalendarHref({ pluginId: "r_abc", query: `ref=ABCDEFGHJK&exp=${exp}&sig=s1g`, now: NOW });
		expect(href).toBe(`/_emdash/api/plugins/r_abc/public/booking/ics?ref=ABCDEFGHJK&exp=${exp}&sig=s1g`);
	});

	it("EU-FR-08 never builds a calendar link that carries a token, or one that is unsigned or expired", () => {
		const cases = [
			undefined,
			"",
			`ref=A&exp=${exp}`,
			"ref=A&sig=x",
			`ref=A&exp=${exp}&sig=x&accessToken=abc`,
			`ref=A&exp=${exp}&sig=x&t=abc`,
			`ref=A&exp=${Math.floor(NOW / 1000) - 1}&sig=x`,
			`ref=A&exp=soon&sig=x`,
		];
		for (const query of cases) expect(bookingCalendarHref({ pluginId: "p", query, now: NOW })).toBeUndefined();
	});

	it("EU-FR-08 links the public event calendar file by event id", () => {
		expect(eventCalendarHref("r_abc", "ev/1")).toBe("/_emdash/api/plugins/r_abc/public/event/ics?eventId=ev%2F1");
	});
});

describe("ticket names on the booking page (T134, T135 follow-up)", () => {
	it("EU-FR-09 names each ticket type from the public/event answer, so lines never show a raw id", () => {
		const event = {
			ticketTypes: [
				{ id: "0b4f6d3e-9c1a-4c8e-8a51-2f3c9d7e6a10", name: "Class place", priceMinor: 0 },
				{ id: "tt_b", name: "Balcony", priceMinor: 500 },
			],
		};
		expect(ticketNames(event)).toEqual({ "0b4f6d3e-9c1a-4c8e-8a51-2f3c9d7e6a10": "Class place", tt_b: "Balcony" });
		expect(ticketNames(undefined)).toEqual({});
	});
});
