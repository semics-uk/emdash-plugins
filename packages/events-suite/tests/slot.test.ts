import { describe, expect, it } from "vitest";
import { retryCookieName } from "../src/astro/lib/flow";
import { WAIVER_PATH } from "../src/astro/lib/form";
import { waiverSlot } from "../src/astro/lib/slot";

// The waiver page names the event and the booked date and time (T148), read through Events' public
// routes (`public/booking`, `public/event`) against a faked host.

const EVENTS = "r_events1";
const IDS = { eventsPluginId: EVENTS, esignPluginId: "r_esign1" };
const REF = "ABCDEFGHJK";
const ACCESS = "A".repeat(43);
const ORIGIN = "https://site.example";

type Responder = (body: Record<string, unknown>) => unknown;
const ok = (data: Record<string, unknown>) => ({ success: true, data: { ok: true, ...data } });

function host(routes: Record<string, Responder>) {
	const calls: Array<{ id: string; path: string; body: Record<string, unknown> }> = [];
	const handler = async (id: string, _method: string, path: string, request: Request) => {
		const body = (await request
			.clone()
			.json()
			.catch(() => ({}))) as Record<string, unknown>;
		calls.push({ id, path, body });
		const respond = routes[`${id} ${path}`];
		return respond
			? respond(body)
			: { success: true, data: { ok: false, error: { code: "NOT_FOUND", message: "NOT_FOUND" } } };
	};
	return { calls, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never };
}

const jar = { [retryCookieName(REF)]: ACCESS };
const request = new Request(`${ORIGIN}${WAIVER_PATH}?ref=${REF}`);
const ctx = (h: ReturnType<typeof host>, cookies: Record<string, string> = jar) => ({
	locals: h.locals,
	url: new URL(request.url),
	request,
	cookie: (name: string) => cookies[name],
});
const eventAnswer = (extra: Record<string, unknown>) =>
	ok({ title: "Clay session", timezone: "Europe/London", ticketTypes: [], ...extra });

describe("the waiver page names the slot (T148)", () => {
	it("a slot booking shows the event title and the booked time in the event's zone, not UTC", async () => {
		const h = host({
			[`${EVENTS} public/booking`]: () => ok({ eventId: "ev_1", occurrenceId: "oc_2" }),
			[`${EVENTS} public/event`]: () =>
				eventAnswer({
					slots: true,
					occurrences: [
						{ id: "oc_1", startsAt: "2026-11-04T09:00:00.000Z" },
						{ id: "oc_2", startsAt: "2026-11-04T13:30:00.000Z" },
					],
				}),
		});
		expect(await waiverSlot(ctx(h), IDS, REF)).toEqual({
			title: "Clay session",
			startsAt: "2026-11-04T13:30:00.000Z",
			when: "Wednesday, 4 November 2026 at 13:30",
		});
		expect(h.calls[0]).toEqual({ id: EVENTS, path: "public/booking", body: { bookingRef: REF, accessToken: ACCESS } });
	});

	it("the zone is the event's: a summer slot in London is an hour ahead of UTC", async () => {
		const h = host({
			[`${EVENTS} public/booking`]: () => ok({ eventId: "ev_1", occurrenceId: "oc_1" }),
			[`${EVENTS} public/event`]: () =>
				eventAnswer({ occurrences: [{ id: "oc_1", startsAt: "2026-07-04T12:30:00.000Z" }] }),
		});
		expect((await waiverSlot(ctx(h), IDS, REF))?.when).toBe("Saturday, 4 July 2026 at 13:30");
	});

	it("a dated event (no occurrence) shows the event's own start", async () => {
		const h = host({
			[`${EVENTS} public/booking`]: () => ok({ eventId: "ev_1" }),
			[`${EVENTS} public/event`]: () => eventAnswer({ startsAt: "2026-11-14T19:00:00.000Z" }),
		});
		expect(await waiverSlot(ctx(h), IDS, REF)).toMatchObject({
			title: "Clay session",
			when: "Saturday, 14 November 2026 at 19:00",
		});
	});

	it("without an access token, or when Events refuses, there is nothing extra to show", async () => {
		const h = host({});
		expect(await waiverSlot(ctx(h, {}), IDS, REF)).toBeUndefined();
		expect(h.calls).toEqual([]);
		expect(await waiverSlot(ctx(h), IDS, REF)).toBeUndefined();
	});

	it("a booked date that is no longer listed still shows the title", async () => {
		const h = host({
			[`${EVENTS} public/booking`]: () => ok({ eventId: "ev_1", occurrenceId: "gone" }),
			[`${EVENTS} public/event`]: () => eventAnswer({ occurrences: [] }),
		});
		expect(await waiverSlot(ctx(h), IDS, REF)).toEqual({ title: "Clay session" });
	});
});
