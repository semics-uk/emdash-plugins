import { describe, expect, it } from "vitest";

import { TEMPLATES_PATH, refreshCatalogue } from "../src/astro/lib/templates";
import { reconcileBooking } from "../src/astro/lib/reconcile";

// Reconciliation and catalogue refresh (SX-FR-05, SX-FR-07): a booking waiting for signatures is
// brought up to date from e-sign when its status page loads (a signer who closed the tab, or signed
// by email), and the Events panel's Refresh templates reads e-sign's catalogue. Both go through the
// cores' public routes in-process with registry-style ids, against a faked host. The Events side
// here is a model of the core's rules (idempotent, monotonic); the real core is exercised by the
// Pro editions tests, which run the same requests against the built bundle.

const EVENTS = "r_events1";
const ESIGN = "r_esign1";
const REF = "ABCDEFGHJK";
const RECEIPT = (n: number) => `${String(n).repeat(120)}.${"s".repeat(43)}`;
const LOOKUP = (ref: string) => `lookup-${ref.replace(":", "-")}.${"m".repeat(43)}`;
const ORIGIN = "https://site.example";

type Body = Record<string, unknown>;
type Answer = { success: boolean; data: Body };
const ok = (data: Body): Answer => ({ success: true, data: { ok: true, ...data } });
const refused = (code: string): Answer => ({ success: true, data: { ok: false, error: { code, message: code } } });

/** A host answering `<id> <path>` and recording each call. */
function host(routes: Record<string, (body: Body) => Answer>) {
	const calls: Array<{ id: string; path: string; body: Body }> = [];
	const handler = async (id: string, _method: string, path: string, request: Request) => {
		const body = (await request
			.clone()
			.json()
			.catch(() => ({}))) as Body;
		calls.push({ id, path, body });
		return (routes[`${id} ${path}`] ?? (() => refused("NOT_FOUND")))(body);
	};
	return { calls, ctx: { locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url: new URL(`${ORIGIN}/booking`) } };
}

/** The booking page's data while two seats wait: seat 1 closed its tab, seat 2 is still unsigned. */
const waiting = (over: Body = {}) => ({
	bookingRef: REF,
	status: "awaiting_signature",
	lines: [{ ticketTypeId: "tt_a", qty: 2 }],
	totals: { totalMinor: 0, currency: "GBP" },
	attendees: [],
	canCancel: true,
	waiver: {
		refs: [`${REF}:1`, `${REF}:2`],
		lookups: { [`${REF}:1`]: LOOKUP(`${REF}:1`), [`${REF}:2`]: LOOKUP(`${REF}:2`) },
	},
	...over,
});

const input = (booking: ReturnType<typeof waiting>) => ({ booking, pluginId: EVENTS, esignPluginId: ESIGN });

/** E-sign's lookup: seat 1 is signed (a terminal receipt), seat 2 is still pending. */
const lookup = (body: Body) =>
	body.request === LOOKUP(`${REF}:1`)
		? ok({ state: "terminal", receipt: RECEIPT(1) })
		: ok({ state: "pending", receipt: null });

/** A model of Events' `signatures/receipt`: stores each receipt once, a replay is a no-op. */
function eventsModel() {
	const stored = new Map<string, string>();
	let writes = 0;
	const route = (body: Body) => {
		const receipt = String(body.receipt);
		if (stored.get(receipt) !== receipt) {
			stored.set(receipt, receipt);
			writes += 1;
		}
		return ok({ bookingRef: REF, status: "awaiting_signature", signature: { status: "completed" } });
	};
	return { route, stored, writes: () => writes };
}

describe("reconcile on status page load (SX-FR-05)", () => {
	it("SX-FR-05 closed-tab scenario: the receipt e-sign already holds is fetched and forwarded to Events", async () => {
		const events = eventsModel();
		const h = host({
			[`${ESIGN} public/receipts/lookup`]: lookup,
			[`${EVENTS} signatures/receipt`]: events.route,
		});
		const result = await reconcileBooking(h.ctx, input(waiting()));
		expect(result).toEqual({ forwarded: 1 });
		expect(h.calls.map((c) => `${c.id} ${c.path}`)).toEqual([
			`${ESIGN} public/receipts/lookup`,
			`${ESIGN} public/receipts/lookup`,
			`${EVENTS} signatures/receipt`,
		]);
		expect(h.calls[0]?.body).toEqual({ request: LOOKUP(`${REF}:1`) });
		expect(h.calls[2]?.body).toEqual({ receipt: RECEIPT(1) });
		expect([...events.stored.keys()]).toEqual([RECEIPT(1)]);
	});

	it("SX-FR-05 forwarding twice changes nothing: the second visit leaves Events as the first left it", async () => {
		const events = eventsModel();
		const h = host({
			[`${ESIGN} public/receipts/lookup`]: lookup,
			[`${EVENTS} signatures/receipt`]: events.route,
		});
		await reconcileBooking(h.ctx, input(waiting()));
		const after = { stored: [...events.stored], writes: events.writes() };
		await reconcileBooking(h.ctx, input(waiting()));
		expect({ stored: [...events.stored], writes: events.writes() }).toEqual(after);
		expect(events.writes()).toBe(1);
	});

	it("SX-FR-05 Free (no waiver data, or no lookup requests): no call is made", async () => {
		const h = host({});
		const { waiver: _, ...plain } = waiting();
		expect(await reconcileBooking(h.ctx, input(plain as never))).toEqual({ forwarded: 0 });
		expect(await reconcileBooking(h.ctx, input(waiting({ waiver: { refs: [`${REF}:1`] } })))).toEqual({
			forwarded: 0,
		});
		expect(h.calls).toEqual([]);
	});

	it("SX-FR-05 an e-sign that is down or refuses the request never breaks the status page", async () => {
		const h = host({ [`${ESIGN} public/receipts/lookup`]: () => refused("TOKEN_EXPIRED") });
		expect(await reconcileBooking(h.ctx, input(waiting()))).toEqual({ forwarded: 0 });
		const down = host({});
		expect(await reconcileBooking(down.ctx, input(waiting()))).toEqual({ forwarded: 0 });
		// Nothing was forwarded to Events.
		expect(h.calls.every((c) => c.id === ESIGN)).toBe(true);
	});

	it("SX-FR-05 only refs with a lookup request are asked, at most ten, and a receipt that is not a token is dropped", async () => {
		const refs = Array.from({ length: 12 }, (_, i) => `${REF}:${i + 1}`);
		const lookups = Object.fromEntries(refs.slice(0, 11).map((r) => [r, LOOKUP(r)]));
		const h = host({
			[`${ESIGN} public/receipts/lookup`]: () => ok({ state: "terminal", receipt: "not a token" }),
			[`${EVENTS} signatures/receipt`]: () => ok({}),
		});
		expect(await reconcileBooking(h.ctx, input(waiting({ waiver: { refs, lookups } })))).toEqual({ forwarded: 0 });
		expect(h.calls).toHaveLength(10);
		expect(h.calls.every((c) => c.path === "public/receipts/lookup")).toBe(true);
	});

	it("SX-FR-05 a pending or unknown envelope forwards nothing", async () => {
		const h = host({ [`${ESIGN} public/receipts/lookup`]: () => ok({ state: "none", receipt: null }) });
		expect(await reconcileBooking(h.ctx, input(waiting()))).toEqual({ forwarded: 0 });
	});
});

describe("catalogue refresh (SX-FR-07)", () => {
	const TOKEN = `catalog.${"c".repeat(43)}`;
	const templates = [
		{ id: "tpl_climb", name: "Climbing waiver", version: 2 },
		{ id: "tpl_swim", name: "Swim waiver", version: 1 },
	];

	it("SX-FR-07 asks e-sign for the catalogue with the request the panel minted, then hands it to Events", async () => {
		const cached: Body[] = [];
		const h = host({
			[`${ESIGN} public/templates/catalog`]: () => ok({ templates }),
			[`${EVENTS} esign/catalog`]: (body) => {
				cached.push(body);
				return ok({ count: 2 });
			},
		});
		const result = await refreshCatalogue(h.ctx, TOKEN, { eventsPluginId: EVENTS, esignPluginId: ESIGN });
		expect(result).toEqual({ ok: true, count: 2 });
		expect(h.calls.map((c) => `${c.id} ${c.path}`)).toEqual([
			`${ESIGN} public/templates/catalog`,
			`${EVENTS} esign/catalog`,
		]);
		expect(h.calls[0]?.body).toEqual({ request: TOKEN });
		// Events gets the same request (it proves the admin asked) and the list; the select is built from it.
		expect(cached).toEqual([{ request: TOKEN, templates }]);
	});

	it("SX-FR-07 an unusable token, a refusing e-sign or a Free Events core is a defined failure", async () => {
		const ids = { eventsPluginId: EVENTS, esignPluginId: ESIGN };
		const none = host({});
		expect(await refreshCatalogue(none.ctx, "nope", ids)).toEqual({ ok: false, code: "REQUEST_INVALID" });
		expect(none.calls).toEqual([]);
		const refusing = host({ [`${ESIGN} public/templates/catalog`]: () => refused("TOKEN_EXPIRED") });
		expect(await refreshCatalogue(refusing.ctx, TOKEN, ids)).toEqual({ ok: false, code: "TOKEN_EXPIRED" });
		const free = host({ [`${ESIGN} public/templates/catalog`]: () => ok({ templates }) });
		expect(await refreshCatalogue(free.ctx, TOKEN, ids)).toEqual({ ok: false, code: "NOT_FOUND" });
	});

	it("SX-FR-07 templates that break the id grammar are left out; the page path is the suite's", async () => {
		const sent: Body[] = [];
		const h = host({
			[`${ESIGN} public/templates/catalog`]: () =>
				ok({ templates: [...templates, { id: "bad id!", name: "x", version: 1 }, { id: "tpl_n", name: 5, version: 1 }] }),
			[`${EVENTS} esign/catalog`]: (body) => {
				sent.push(body);
				return ok({ count: 2 });
			},
		});
		await refreshCatalogue(h.ctx, TOKEN, { eventsPluginId: EVENTS, esignPluginId: ESIGN });
		expect(sent[0]?.templates).toEqual(templates);
		expect(TEMPLATES_PATH).toBe("/_events/templates");
	});
});
