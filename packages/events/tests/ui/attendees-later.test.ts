import { describe, expect, it } from "vitest";

import { handleAttendeeAction, readAttendeeEdits, signingRows, waiverStep } from "../../src/astro/lib/attendees";
import type { BookingView } from "../../src/astro/lib/widget";
import { t } from "../../src/i18n/index";

// T174e: a booking request is booked without names. Once staff confirm it, Events Pro's `public/booking` lists its
// seats with the after-approval waiver (`waiverAfter`); a seat still in the buyer's name signs by `none` until the
// buyer names it, and `signingList.minors` lets the edit form mark a seat under 18. The page asks for the names; no
// Sign now for an unnamed seat, and the "Sign the waiver" step only when someone can sign.

const url = new URL("https://site.example/booking?ref=ABCDEFGHJK");
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
const form = (fields: Record<string, string>) => {
	const f = new FormData();
	for (const [k, v] of Object.entries(fields)) f.set(k, v);
	return f;
};
const unnamed = (seat: string) => ({
	name: "Ada Lovelace",
	status: "pending",
	seat,
	email: "ada@example.com",
	signing: "waiting",
	signs: "none",
});

function booking(over: Partial<BookingView> = {}): BookingView {
	return {
		bookingRef: "ABCDEFGHJK",
		status: "confirmed",
		lines: [{ ticketTypeId: "party", qty: 3 }],
		totals: { totalMinor: 7500, currency: "GBP" },
		canCancel: true,
		waiverAfter: true,
		attendees: [
			{
				name: "Ada Lovelace",
				status: "pending",
				seat: "1",
				email: "ada@example.com",
				signing: "signed",
				signs: "inline",
			},
			unnamed("2"),
			unnamed("3"),
		],
		signingList: { editable: true, editUntil: "2026-12-01T09:00:00.000Z", minors: true },
		...over,
	} as BookingView;
}

describe("T174e unnamed seats of a booking request", () => {
	it("T174e an unnamed seat asks for a name: no Sign now, but editable", () => {
		const rows = signingRows(booking()) ?? [];
		expect(rows.map((r) => [r.seat, r.unnamed, r.canSign, r.canEdit])).toEqual([
			["1", false, false, false],
			["2", true, false, true],
			["3", true, false, true],
		]);
		expect(t("en", "booking.attendees.unnamed")).toMatch(/name and email/);
	});

	it("T174e the Sign the waiver step shows only when a seat can be signed or invited", () => {
		expect(waiverStep(booking())).toBeNull();
		const named = booking({
			attendees: [
				{
					name: "Ada Lovelace",
					status: "pending",
					seat: "1",
					email: "ada@example.com",
					signing: "waiting",
					signs: "inline",
				},
				unnamed("2"),
			],
		} as Partial<BookingView>);
		expect(waiverStep(named)).toEqual({ sign: true, invite: false });
	});

	it("T174e with minors the edit form sends whether each seat is under 18 (a minor has no email)", () => {
		const rows = signingRows(booking()) ?? [];
		const edits = readAttendeeEdits(
			form({
				"name:2": "Charles Babbage",
				"email:2": "charles@example.com",
				"name:3": "Byron",
				"email:3": "ada@example.com",
				"minor:3": "on",
			}),
			rows,
			true,
		);
		expect(edits).toEqual([
			{ seat: "2", name: "Charles Babbage", email: "charles@example.com", minor: false },
			{ seat: "3", name: "Byron", minor: true },
		]);
	});

	it("T174e Save posts the request's edits with minor, and redeems the invitation it gets", async () => {
		const h = host({
			"semics-events public/booking/attendees": [
				{
					success: true,
					data: { ok: true, changed: 1, intents: [{ ref: "ABCDEFGHJK:2", delivery: "email", token: "x" }] },
				},
			],
			"semics-esign public/envelopes/from-intent": [{ success: true, data: { ok: true, status: "sent" } }],
		});
		const out = await handleAttendeeAction(
			h.ctx,
			form({
				intent: "attendees",
				"name:2": "Charles Babbage",
				"email:2": "charles@example.com",
				"name:3": "Ada Lovelace",
				"email:3": "ada@example.com",
			}),
			access,
			ids,
			booking(),
		);
		expect(out).toEqual({ location: "/booking?ref=ABCDEFGHJK&attendees=saved" });
		expect(h.seen[0]?.body).toMatchObject({
			attendees: [
				{ seat: "2", name: "Charles Babbage", email: "charles@example.com", minor: false },
				{ seat: "3", name: "Ada Lovelace", email: "ada@example.com", minor: false },
			],
		});
		expect(h.seen.map((s) => s.path)).toEqual(["public/booking/attendees", "public/envelopes/from-intent"]);
	});
});
