import { generateToken, hashToken, signLink } from "@semics-tech/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { LINK_KEY } from "../../src/domain/link-secret";
import { type BookingDeps, type BookingRouteStorage, bookingStatus } from "../../src/routes/booking";
import { bookingIcs, eventIcs, type IcsDeps } from "../../src/routes/ics";
import { type RedeemDeps, redeemBooking } from "../../src/routes/redeem";
import { meter } from "../domain/fake-storage";
import { type Doc, ID, NOW, REF, START, world } from "../emails/world";

// Calendar routes, the booking answer's calendar query and check-in codes, and the redeem exchange
// (EV-US-3, EV-FR-08, EV-FR-09, R22, R33).

beforeEach(() => {
	meter.calls = 0;
});

type W = Awaited<ReturnType<typeof world>>;

const icsDeps = (w: W, now = NOW): IcsDeps => ({
	storage: w.storage as unknown as IcsDeps["storage"],
	settings: w.settings,
	content: w.content,
	kv: w.kv,
	now,
});
const bookingDeps = (w: W, now = NOW): BookingDeps => ({
	storage: w.storage as unknown as BookingRouteStorage,
	settings: { list: async () => [] },
	kv: w.kv,
	now,
});

async function calendarQuery(w: W, now = NOW): Promise<string> {
	const body = (await bookingStatus(bookingDeps(w, now), { bookingRef: REF, accessToken: w.token })) as {
		calendar?: { query: string };
	};
	return body.calendar?.query ?? "";
}

describe("EV-FR-08 public/booking issues the calendar link and passes (R33)", () => {
	it("R33 returns calendar.query signed for events/booking-ics, and each valid attendee's code", async () => {
		const w = await world();
		const body = (await bookingStatus(bookingDeps(w), { bookingRef: REF, accessToken: w.token })) as Doc & {
			calendar: { query: string };
			attendees: Array<{ name: string; code?: string }>;
		};
		const q = new URLSearchParams(body.calendar.query);
		expect(q.get("ref")).toBe(REF);
		expect(q.get("sig")).toBeTruthy();
		expect(Number(q.get("exp"))).toBe(Math.floor((NOW + 15 * 60_000) / 1000));
		expect(q.has("token") || q.has("accessToken") || q.has("t")).toBe(false);
		expect(body.attendees.map((a) => [a.name, a.code])).toEqual([
			["Ada Lovelace", "code-1_x-Y"],
			["Grace Hopper", "code-2_x-Y"],
		]);
	});

	it("R33 gives neither codes nor a calendar to a wrong token", async () => {
		const w = await world();
		const body = await bookingStatus(bookingDeps(w), { bookingRef: REF, accessToken: generateToken() });
		expect(JSON.stringify(body)).not.toContain("code-1");
		expect(body).not.toHaveProperty("calendar");
	});

	it("EV-FR-08 a cancelled booking has no calendar link", async () => {
		const w = await world({ status: "cancelled" });
		const body = await bookingStatus(bookingDeps(w), { bookingRef: REF, accessToken: w.token });
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		expect(body).not.toHaveProperty("calendar");
	});

	it("R22 status stays within the budget including the link key (first use creates it)", async () => {
		const w = await world();
		meter.calls = 0;
		await bookingStatus(bookingDeps(w), { bookingRef: REF, accessToken: w.token });
		expect(meter.calls).toBeLessThanOrEqual(8);
		expect(w.kv.values.has(LINK_KEY)).toBe(true);
	});
});

describe("EV-FR-08 public/booking/ics", () => {
	it("EV-FR-08 returns a calendar in the event's time zone for a valid link", async () => {
		const w = await world({ timezone: "America/New_York" });
		const raw = await bookingIcs(icsDeps(w), new URLSearchParams(await calendarQuery(w)));
		expect(raw.status).toBe(200);
		expect(raw.contentType).toBe("text/calendar; charset=utf-8");
		expect(raw.disposition).toBe('attachment; filename="booking.ics"');
		expect(raw.body).toContain("BEGIN:VCALENDAR");
		expect(raw.body).toContain("BEGIN:VTIMEZONE");
		expect(raw.body).toContain("TZID:America/New_York");
		expect(raw.body).toContain("DTSTART;TZID=America/New_York:20261114T140000");
		expect(raw.body).toContain("SUMMARY:Winter Concert");
		expect(raw.body).toContain("LOCATION:Town Hall\\, Market Street");
		expect(raw.body).toContain(`UID:booking-${REF}@semics-events`);
		expect(raw.body.endsWith("END:VCALENDAR\r\n")).toBe(true);
		expect(raw.body).not.toContain(w.token);
	});

	it("EV-FR-08 uses the occurrence's start for a recurring event", async () => {
		const w = await world({ occurrence: true, timezone: "Europe/London" });
		const raw = await bookingIcs(icsDeps(w), new URLSearchParams(await calendarQuery(w)));
		expect(raw.body).toContain("DTSTART;TZID=Europe/London:20261121T190000");
	});

	it("EV-FR-08 an expired link fails with TOKEN_EXPIRED", async () => {
		const w = await world();
		const query = new URLSearchParams(await calendarQuery(w));
		const raw = await bookingIcs(icsDeps(w, NOW + 16 * 60_000), query);
		expect(raw.status).toBe(401);
		expect(JSON.parse(raw.body)).toMatchObject({ ok: false, error: { code: "TOKEN_EXPIRED" } });
	});

	it("EV-FR-08 a tampered, unsigned or other-purpose link fails with TOKEN_INVALID", async () => {
		const w = await world();
		const good = new URLSearchParams(await calendarQuery(w));
		const tampered = new URLSearchParams(good);
		tampered.set("ref", "ZZZZZZZZZZ");
		const secretHex = (w.kv.values.get(LINK_KEY)?.value ?? "") as string;
		const secret = Uint8Array.from(secretHex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
		const other = await signLink({ secret, purpose: "esign/download", params: { ref: REF }, now: NOW });
		for (const query of [tampered, new URLSearchParams({ ref: REF }), other, new URLSearchParams()]) {
			const raw = await bookingIcs(icsDeps(w), query);
			expect(JSON.parse(raw.body).error.code).toBe("TOKEN_INVALID");
		}
	});

	it("EV-FR-08 a valid link for a booking that is no longer confirmed is NOT_FOUND", async () => {
		const w = await world();
		const query = new URLSearchParams(await calendarQuery(w));
		w.storage.bookings.set(ID, { ...w.booking(), status: "cancelled" });
		const raw = await bookingIcs(icsDeps(w), query);
		expect(raw.status).toBe(404);
	});

	it("R22 serves a one-off booking in 5 bridge calls or fewer", async () => {
		const w = await world();
		const query = new URLSearchParams(await calendarQuery(w));
		meter.calls = 0;
		await bookingIcs(icsDeps(w), query);
		expect(meter.calls).toBeLessThanOrEqual(5);
	});
});

describe("EV-FR-08 public/event/ics", () => {
	it("EV-FR-08 serves the event with no booking data and no signature", async () => {
		const w = await world({ timezone: "Asia/Tokyo" });
		const raw = await eventIcs(icsDeps(w), new URLSearchParams({ eventId: "ev1" }));
		expect(raw.status).toBe(200);
		expect(raw.body).toContain("TZID:Asia/Tokyo");
		expect(raw.body).toContain("DTSTART;TZID=Asia/Tokyo:20261115T040000");
		expect(raw.body).not.toContain(REF);
		expect(raw.body).not.toContain("ada@example.com");
		expect(raw.disposition).toBe('attachment; filename="event.ics"');
	});

	it("EV-FR-08 lists one VEVENT per open occurrence of a recurring event", async () => {
		const w = await world({ occurrence: true });
		w.storage.occurrences.set("oc2", {
			eventId: "ev1",
			startsAt: new Date(START + 14 * 86_400_000).toISOString(),
			capacity: 10,
			reserved: 0,
			sold: 0,
			status: "open",
		});
		w.storage.occurrences.set("oc3", { ...(w.storage.occurrences.docs.get("oc2") as Doc), status: "cancelled" });
		const raw = await eventIcs(icsDeps(w), new URLSearchParams({ eventId: "ev1" }));
		expect(raw.body.match(/BEGIN:VEVENT/g)).toHaveLength(2);
	});

	it("EV-FR-17 lists the upcoming dates, not a slot schedule's oldest 50 (T130, R94 follow-up)", async () => {
		const w = await world({ occurrence: true });
		for (let i = 1; i <= 60; i++) {
			w.storage.occurrences.set(`past${i}`, {
				eventId: "ev1",
				startsAt: new Date(NOW - i * 86_400_000).toISOString(),
				capacity: 10,
				reserved: 0,
				sold: 0,
				status: "open",
			});
		}
		const raw = await eventIcs(icsDeps(w), new URLSearchParams({ eventId: "ev1" }));
		expect(raw.body.match(/BEGIN:VEVENT/g)).toHaveLength(1);
		expect(raw.body).not.toContain("-past");
	});

	it("EV-FR-08 an unknown event or a malformed id is NOT_FOUND or BAD_REQUEST", async () => {
		const w = await world();
		expect((await eventIcs(icsDeps(w), new URLSearchParams({ eventId: "nope" }))).status).toBe(404);
		expect((await eventIcs(icsDeps(w), new URLSearchParams({ eventId: "a b" }))).status).toBe(400);
		expect((await eventIcs(icsDeps(w), new URLSearchParams())).status).toBe(400);
	});
});

describe("T057 public/event/ics answers only for a public event (EV-FR-03)", () => {
	it("EV-FR-03 a draft, unpublished, orphaned or unconfigured event has no public calendar file", async () => {
		const states: Array<Record<string, unknown> | null> = [
			{ status: "draft" },
			{ unpublished: true },
			{ orphaned: true },
			null,
		];
		for (const state of states) {
			const w = await world();
			const config = w.storage.event_configs.docs.get("ev1") as Doc;
			if (state) w.storage.event_configs.set("ev1", { ...config, ...state });
			else w.storage.event_configs.docs.delete("ev1");
			const raw = await eventIcs(icsDeps(w), new URLSearchParams({ eventId: "ev1" }));
			expect(raw.status, JSON.stringify(state)).toBe(404);
			expect(raw.body).not.toContain("Winter Concert");
		}
	});

	it("EV-FR-03 a published config without its copy of the entry still falls back to the entry", async () => {
		const w = await world({ denormalised: false });
		const raw = await eventIcs(icsDeps(w), new URLSearchParams({ eventId: "ev1" }));
		expect(raw.status).toBe(200);
		expect(raw.body).toContain("Winter Concert");
	});
});

describe("EV-FR-08 public/booking/redeem exchanges the emailed one-time code for an access token", () => {
	async function emailed(w: W) {
		const { drainEventsOutbox } = await import("../../src/emails/outbox");
		await drainEventsOutbox(w.deps());
		const code = /[?&]k=([A-Za-z0-9_-]{43})/.exec(w.sent[0]?.text ?? "")?.[1] ?? "";
		return code;
	}
	const deps = (w: W, now = NOW): RedeemDeps => ({ storage: w.storage as unknown as RedeemDeps["storage"], now });

	it("EV-FR-08 returns a fresh access token that replaces the old one, once", async () => {
		const w = await world();
		const code = await emailed(w);
		meter.calls = 0;
		const body = (await redeemBooking(deps(w), { bookingRef: REF, code })) as { ok: boolean; accessToken: string };
		expect(meter.calls).toBe(2);
		expect(body).toMatchObject({ ok: true, bookingRef: REF });
		expect(body.accessToken).toHaveLength(43);
		expect(w.booking().accessTokenHash).toBe(await hashToken(body.accessToken));
		expect(w.booking().redeemHash).toBeNull();
		expect(w.booking().redeemExpiresAt).toBeNull();
		const status = await bookingStatus(bookingDeps(w), { bookingRef: REF, accessToken: body.accessToken });
		expect(status).toMatchObject({ ok: true, status: "confirmed" });
		const replay = await redeemBooking(deps(w), { bookingRef: REF, code });
		expect(replay).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
	});

	it("EV-FR-08 a wrong code, an unknown ref and an expired code all answer NOT_FOUND", async () => {
		const w = await world();
		const code = await emailed(w);
		const wrong = await redeemBooking(deps(w), { bookingRef: REF, code: generateToken() });
		const unknown = await redeemBooking(deps(w), { bookingRef: "ZZZZZZZZZZ", code });
		const expired = await redeemBooking(deps(w, NOW + 8 * 86_400_000), { bookingRef: REF, code });
		expect(wrong).toEqual(unknown);
		expect(expired).toEqual(unknown);
		expect(unknown).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
		expect(w.booking().accessTokenHash).toBe(await hashToken(w.token));
	});

	it("EV-FR-08 a booking with no pending code cannot be redeemed, and bad input is a BAD_REQUEST", async () => {
		const w = await world();
		expect(await redeemBooking(deps(w), { bookingRef: REF, code: generateToken() })).toMatchObject({
			error: { code: "NOT_FOUND" },
		});
		expect(await redeemBooking(deps(w), { bookingRef: REF })).toMatchObject({ error: { code: "BAD_REQUEST" } });
		expect(await redeemBooking(deps(w), { bookingRef: REF, code: "short", extra: 1 })).toMatchObject({
			error: { code: "BAD_REQUEST" },
		});
	});
});
