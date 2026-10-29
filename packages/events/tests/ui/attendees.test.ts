import { describe, expect, it } from "vitest";

import { handleAttendeeAction, readAttendeeEdits, signingRows } from "../../src/astro/lib/attendees";
import type { BookingView } from "../../src/astro/lib/widget";

// T133 (R95, R48): the booking page's attendee signing list (Suite Pro). Events Pro's `public/booking`
// describes each seat of a waiver booking (`seat`, `signing`, `signs`) and whether the names may still
// be changed (`signingList`); Free sends none of it, so the page shows nothing new. The page's forms
// post back to `/booking`, which calls the Pro routes with the cookie's access token (never a field)
// and redeems what they mint with e-sign in-process: no JavaScript is needed.

const url = new URL("https://site.example/booking?ref=ABCDEFGHJK");
const INTENT = `${"p".repeat(80)}.${"s".repeat(43)}`;
const INTENT2 = `${"q".repeat(80)}.${"s".repeat(43)}`;
const LOOKUP = `${"l".repeat(60)}.${"s".repeat(43)}`;
const SIGNING = "S".repeat(43);
const ids = { pluginId: "semics-events", esignPluginId: "semics-esign" };
const access = { ref: "ABCDEFGHJK", token: "T".repeat(43) };

function host(answers: Record<string, unknown[]>) {
	const seen: Array<{ id: string; path: string; body: unknown }> = [];
	const handler = async (id: string, _method: string, path: string, request: Request) => {
		seen.push({ id, path, body: await request.clone().json() });
		const queue = answers[`${id} ${path}`];
		return queue?.shift() ?? { success: true, data: { ok: false, error: { code: "NOT_FOUND" } } };
	};
	return { seen, ctx: { locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url } };
}
const okData = (data: Record<string, unknown>) => ({ success: true, data: { ok: true, ...data } });
const refused = (code: string, issues?: unknown[]) => ({
	success: true,
	data: { ok: false, error: { code, message: "no" }, ...(issues ? { issues } : {}) },
});
const form = (fields: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
};

function booking(over: Partial<BookingView> = {}): BookingView {
	return {
		bookingRef: "ABCDEFGHJK",
		status: "awaiting_signature",
		lines: [{ ticketTypeId: "adult", qty: 3 }],
		totals: { totalMinor: 0, currency: "GBP" },
		canCancel: true,
		attendees: [
			{ name: "Ada Lovelace", status: "pending", seat: "1", email: "ada@example.com", signing: "signed", signs: "inline" },
			{ name: "Byron", status: "pending", seat: "2", minor: true, signing: "waiting", signs: "inline" },
			{
				name: "Charles Babbage",
				status: "pending",
				seat: "3",
				email: "charles@example.com",
				signing: "waiting",
				signs: "email",
			},
		],
		signingList: { editable: true, editUntil: "2026-12-01T09:00:00.000Z" },
		...over,
	} as BookingView;
}

describe("T133 R95 the signing list rows", () => {
	it("R95 a Free answer (no signing list) shows no list", () => {
		const free = booking({ signingList: undefined });
		expect(signingRows(free)).toBeNull();
		expect(signingRows(booking({ attendees: [{ name: "A", status: "valid" }] }))).toBeNull();
	});

	it("R95 each attendee is Signed or Waiting; Sign now for every waiting seat, Resend only for emailed adults", () => {
		const rows = signingRows(booking()) ?? [];
		expect(rows.map((r) => [r.seat, r.signed, r.canSign, r.canResend, r.canEdit])).toEqual([
			["1", true, false, false, false],
			["2", false, true, false, true],
			["3", false, true, true, true],
		]);
		expect(rows[1]?.minor).toBe(true);
	});

	it("R95 after the cutoff nothing is editable, and a cancelled or expired booking offers no actions", () => {
		const closed = signingRows(booking({ signingList: { editable: false } })) ?? [];
		expect(closed.map((r) => r.canEdit)).toEqual([false, false, false]);
		expect(closed.map((r) => r.canSign)).toEqual([false, true, true]);
		for (const status of ["cancelled", "expired", "held"]) {
			const rows = signingRows(booking({ status })) ?? [];
			expect(rows.some((r) => r.canSign || r.canResend || r.canEdit), status).toBe(false);
		}
	});
});

describe("T133 R95 reading the edit form", () => {
	it("R95 only editable seats are read, trimmed; a minor has no email; unknown seats are ignored", () => {
		const rows = signingRows(booking()) ?? [];
		const edits = readAttendeeEdits(
			form({
				"name:1": "Someone Else",
				"name:2": "  Lord Byron ",
				"email:2": "x@example.com",
				"name:3": "Charles Babbage",
				"email:3": " c.babbage@example.com ",
				"name:9": "Ghost",
			}),
			rows,
		);
		expect(edits).toEqual([
			{ seat: "2", name: "Lord Byron" },
			{ seat: "3", name: "Charles Babbage", email: "c.babbage@example.com" },
		]);
	});
});

describe("T133 R95 the booking page's attendee actions", () => {
	it("R95 an unknown intent is not ours", async () => {
		const h = host({});
		expect(await handleAttendeeAction(h.ctx, form({ intent: "cancel" }), access, ids, booking())).toBeNull();
		expect(h.seen).toEqual([]);
	});

	it("R95 Sign now asks Events Pro for the seat's intent with the booking token, then opens e-sign's page", async () => {
		const h = host({
			"semics-events public/booking/attendees/sign": [okData({ intent: INTENT, lookup: LOOKUP })],
			"semics-esign public/envelopes/from-intent": [okData({ status: "sent", signingToken: SIGNING })],
		});
		const out = await handleAttendeeAction(h.ctx, form({ intent: "sign-now", seat: "3" }), access, ids, booking());
		expect(out).toEqual({ location: `/sign/${SIGNING}` });
		expect(h.seen).toEqual([
			{
				id: "semics-events",
				path: "public/booking/attendees/sign",
				body: { bookingRef: "ABCDEFGHJK", accessToken: access.token, seat: "3" },
			},
			{ id: "semics-esign", path: "public/envelopes/from-intent", body: { intent: INTENT } },
		]);
	});

	it("R95 Sign now for a seat that cannot sign here sends nothing", async () => {
		const h = host({});
		const out = await handleAttendeeAction(h.ctx, form({ intent: "sign-now", seat: "1" }), access, ids, booking());
		expect(out).toEqual({ location: "/booking?ref=ABCDEFGHJK&error=BAD_REQUEST" });
		expect(h.seen).toEqual([]);
	});

	it("R95 R48 Resend redeems the Pro resend intent with e-sign; a rate limit comes back as its notice", async () => {
		const h = host({
			"semics-events public/booking/attendees/resend": [okData({ intent: INTENT }), refused("RATE_LIMITED")],
			"semics-esign public/envelopes/from-intent": [okData({ status: "sent", resent: true })],
		});
		const resend = form({ intent: "resend", seat: "3" });
		expect(await handleAttendeeAction(h.ctx, resend, access, ids, booking())).toEqual({
			location: "/booking?ref=ABCDEFGHJK&attendees=resent",
		});
		expect(await handleAttendeeAction(h.ctx, resend, access, ids, booking())).toEqual({
			location: "/booking?ref=ABCDEFGHJK&error=RATE_LIMITED",
		});
		// A minor is signed by the guardian on this device: no resend.
		const minor = await handleAttendeeAction(h.ctx, form({ intent: "resend", seat: "2" }), access, ids, booking());
		expect(minor).toEqual({ location: "/booking?ref=ABCDEFGHJK&error=BAD_REQUEST" });
	});

	it("R95 saving names sends the edits, then redeems each minted intent in order (void before the new invitation)", async () => {
		const h = host({
			"semics-events public/booking/attendees": [
				okData({
					changed: 1,
					intents: [
						{ ref: "ABCDEFGHJK:3", delivery: "email", token: INTENT },
						{ ref: "ABCDEFGHJK:3", delivery: "email", token: INTENT2 },
					],
				}),
			],
			"semics-esign public/envelopes/from-intent": [
				okData({ status: "voided", envelopeId: "e1" }),
				okData({ status: "draft", envelopeId: "e2" }),
			],
		});
		const out = await handleAttendeeAction(
			h.ctx,
			form({ intent: "attendees", "name:3": "Charles Babbage", "email:3": "c.babbage@example.com" }),
			access,
			ids,
			booking(),
		);
		expect(out).toEqual({ location: "/booking?ref=ABCDEFGHJK&attendees=saved" });
		expect(h.seen.map((s) => s.path)).toEqual([
			"public/booking/attendees",
			"public/envelopes/from-intent",
			"public/envelopes/from-intent",
		]);
		expect(h.seen[0]?.body).toEqual({
			bookingRef: "ABCDEFGHJK",
			accessToken: access.token,
			attendees: [
				{ seat: "2", name: "Byron" },
				{ seat: "3", name: "Charles Babbage", email: "c.babbage@example.com" },
			],
		});
		expect((h.seen[2]?.body as { intent: string }).intent).toBe(INTENT2);
		// No typed value ever goes into the redirect.
		expect(out?.location).not.toContain("babbage");
	});

	it("R95 a refused edit shows its reason; e-sign refusing an intent says the change is saved but not sent", async () => {
		const h = host({
			"semics-events public/booking/attendees": [
				refused("BAD_REQUEST", [{ path: "attendees.3", code: "ATTENDEE_SIGNED" }]),
				refused("ATTENDEES_LOCKED"),
				refused("BAD_REQUEST", [{ path: "attendees.3.email", code: "invalid_string" }]),
				okData({ changed: 1, intents: [{ ref: "ABCDEFGHJK:3", delivery: "email", token: INTENT }] }),
			],
			"semics-esign public/envelopes/from-intent": [refused("TEMPLATE_NOT_FOUND")],
		});
		const edit = form({ intent: "attendees", "name:3": "C", "email:3": "c@example.com" });
		const codes: string[] = [];
		for (let i = 0; i < 4; i++) {
			const out = await handleAttendeeAction(h.ctx, edit, access, ids, booking());
			codes.push(new URL(out?.location ?? "", url).searchParams.get("error") ?? "");
		}
		expect(codes).toEqual(["ATTENDEE_SIGNED", "ATTENDEES_LOCKED", "ATTENDEE_INVALID", "ATTENDEES_UNSENT"]);
	});

	it("R95 without e-sign configured nothing is called", async () => {
		const h = host({});
		const out = await handleAttendeeAction(
			h.ctx,
			form({ intent: "resend", seat: "3" }),
			access,
			{ pluginId: "semics-events" },
			booking(),
		);
		expect(out).toEqual({ location: "/booking?ref=ABCDEFGHJK&error=ESIGN_NOT_CONFIGURED" });
		expect(h.seen).toEqual([]);
	});
});
