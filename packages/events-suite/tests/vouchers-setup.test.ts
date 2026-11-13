import { describe, expect, it } from "vitest";

import { saveActivities, setupView } from "../src/astro/lib/vouchers-setup";

// T168 (T163 §3, from T166): activity vouchers are picked from Events' catalogue at setup, with Events' prices.
// Vouchers cannot read Events, and a price a buyer's browser sent could not be trusted, so an administrator's
// visit to /_vouchers/setup reads Events' public routes in process and writes Vouchers' `activityTypes` setting
// through the host's own settings handler (which checks `plugins:manage`).

const EVENTS = "r_events1";
const VOUCHERS = "r_vouchers1";
const IDS = { eventsPluginId: EVENTS, vouchersPluginId: VOUCHERS };
const ORIGIN = "https://site.example";

const ok = (data: Record<string, unknown>) => ({ success: true, data: { ok: true, ...data } });

function site({ admin = true, stored = "" } = {}) {
	const writes: Array<{ id: string; values: Record<string, unknown> }> = [];
	const handler = async (id: string, _m: string, path: string, request: Request) => {
		const body = (await request.json().catch(() => ({}))) as { eventId?: string };
		if (id !== EVENTS) return { success: true, data: { ok: false, error: { code: "NOT_FOUND" } } };
		if (path === "public/events") {
			return ok({
				events: [
					{ eventId: "ev_clay", title: "Clay taster", currency: "GBP" },
					{ eventId: "ev_paris", title: "Paris trip", currency: "EUR" },
				],
			});
		}
		if (path === "public/event" && body.eventId === "ev_clay") {
			return ok({
				eventId: "ev_clay",
				title: "Clay taster",
				currency: "GBP",
				ticketTypes: [
					{ id: "tt_session", name: "Session", priceMinor: 4000 },
					{ id: "tt_free", name: "Spectator", priceMinor: 0 },
				],
			});
		}
		if (path === "public/event") {
			return ok({
				eventId: "ev_paris",
				currency: "EUR",
				ticketTypes: [{ id: "tt_seat", name: "Seat", priceMinor: 9900 }],
			});
		}
		return { success: true, data: { ok: false, error: { code: "NOT_FOUND" } } };
	};
	const settings = {
		read: async (id: string) =>
			admin && id === VOUCHERS
				? Response.json({ success: true, data: { values: { activityTypes: stored, currency: "GBP" } } })
				: Response.json({ success: false, error: { code: "FORBIDDEN" } }, { status: 403 }),
		write: async (id: string, values: Record<string, unknown>) => {
			writes.push({ id, values });
			return Response.json({ success: true, data: {} });
		},
	};
	return {
		writes,
		ctx: { locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url: new URL(ORIGIN), settings },
	};
}

describe("T168 R16 /_vouchers/setup", () => {
	it("R16 lists Events' ticket types with Events' prices; marks the ones sold and a price that has moved", async () => {
		const s = site({ stored: "ev_clay, tt_session, 3500, One clay session\nev_gone, tt_old, 1000, Old activity" });
		const view = await setupView(s.ctx, IDS);
		expect(view.state).toBe("ready");
		expect(view.currency).toBe("GBP");
		expect(view.choices).toEqual([
			{
				value: "ev_clay/tt_session",
				label: "One clay session",
				eventTitle: "Clay taster",
				ticketName: "Session",
				priceMinor: 4000,
				chosen: true,
				storedPriceMinor: 3500,
			},
		]);
		// Not from Events' current list: kept as typed, never dropped by a save.
		expect(view.kept).toEqual(["ev_gone, tt_old, 1000, Old activity"]);
	});

	it("R16 skips free tickets and events in another currency (one currency per site)", async () => {
		const view = await setupView(site().ctx, IDS);
		expect(view.choices?.map((c) => c.value)).toEqual(["ev_clay/tt_session"]);
	});

	it("R16 saving writes activityTypes with Events' prices, keeps labels already given, and keeps unseen lines", async () => {
		const s = site({ stored: "ev_clay, tt_session, 3500, One clay session\nev_gone, tt_old, 1000, Old activity" });
		const out = await saveActivities(s.ctx, IDS, ["ev_clay/tt_session"]);
		expect(out).toEqual({ state: "saved", count: 2 });
		expect(s.writes).toEqual([
			{
				id: VOUCHERS,
				values: { activityTypes: "ev_clay, tt_session, 4000, One clay session\nev_gone, tt_old, 1000, Old activity" },
			},
		]);
		const fresh = site();
		await saveActivities(fresh.ctx, IDS, ["ev_clay/tt_session", "ev_clay/tt_nope"]);
		expect(fresh.writes[0]?.values).toEqual({ activityTypes: "ev_clay, tt_session, 4000, Clay taster: Session" });
		await saveActivities(fresh.ctx, IDS, []);
		expect(fresh.writes[1]?.values).toEqual({ activityTypes: "" });
	});

	it("R16 a visitor who may not manage plugins sees nothing and writes nothing", async () => {
		const s = site({ admin: false });
		expect(await setupView(s.ctx, IDS)).toEqual({ state: "forbidden" });
		expect(await saveActivities(s.ctx, IDS, ["ev_clay/tt_session"])).toEqual({ state: "forbidden" });
		expect(s.writes).toEqual([]);
	});
});
