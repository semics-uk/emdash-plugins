import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// page:metadata (schema.org Event JSON-LD) and the content hooks that keep the event config in
// step with its entry: unpublish pauses sales and hides the event, delete with bookings is vetoed
// (Spike S9: exactly `false`), a permanent delete orphans the config (EV-FR-10, T051).

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const host = () => runtime as PluginRuntimeTestHost;
const TARGET = { calls: 8 };

type Config = { status: string; orphaned?: boolean; unpublished?: boolean; reserved: number; capacity: number };
const config = (id: string) => host().inspect.storage.get<Config>("event_configs", id);

const FIELDS = [
	{ slug: "title", label: "Title", type: "string" },
	{ slug: "starts_at", label: "Starts", type: "datetime" },
	{ slug: "ends_at", label: "Ends", type: "datetime" },
	{ slug: "timezone", label: "Timezone", type: "string" },
	{ slug: "venue", label: "Venue", type: "string" },
] as const;

async function setup() {
	runtime = await createPluginRuntimeTestHost({ site: { name: "Town Hall", url: "https://site.test" } });
	await runtime.fixtures.collection({ slug: "events", label: "Events", fields: [...FIELDS] });
	await runtime.fixtures.collection({
		slug: "posts",
		label: "Posts",
		fields: [{ slug: "title", label: "Title", type: "string" }],
	});
	return withBudget(runtime);
}

async function entry(title = "Summer Fete", over: Record<string, unknown> = {}) {
	return host().fixtures.content("events", {
		slug: title.toLowerCase().replaceAll(/[^a-z]+/g, "-"),
		status: "published",
		data: {
			title,
			starts_at: "2099-07-14T19:00:00.000Z",
			ends_at: "2099-07-14T21:00:00.000Z",
			timezone: "Europe/London",
			venue: "Town Hall",
			...over,
		},
	});
}

async function save(eventId: string, status = "on_sale", capacity = 50) {
	const r = (await host().transport.invokeRoute("config/save", {
		eventId,
		config: { status, capacity, currency: "GBP" },
		ticketTypes: [
			{ name: "Adult", priceMinor: 1500, capacity: 30 },
			{ name: "Secret", priceMinor: 100, capacity: 5, sort: 2, hidden: true },
		],
		occurrences: [],
	})) as { ok: boolean };
	expect(r.ok).toBe(true);
}

const page = (id: string, collection = "events") => ({
	page: {
		url: `https://site.test/events/${id}`,
		path: `/events/${id}`,
		locale: null,
		kind: "content",
		pageType: "article",
		title: "x",
		description: null,
		canonical: null,
		image: null,
		content: { collection, id, slug: "x" },
	},
});

type Ld = Record<string, unknown> & { offers: Array<Record<string, unknown>>; location?: Record<string, unknown> };
const graphOf = (value: unknown): Ld => {
	const c = (Array.isArray(value) ? value[0] : value) as { kind: string; graph: Ld };
	expect(c.kind).toBe("jsonld");
	return c.graph;
};

async function booking(eventId: string, status: string, id = "bk_a") {
	await host().fixtures.plugin.storage("bookings", id, {
		ref: "REF0000001",
		eventId,
		status,
		releaseClaimedAt: null,
		buyer: { name: "Ada", email: "ada@example.com" },
		email: "ada@example.com",
		lines: [],
		createdAt: new Date().toISOString(),
	});
}

describe("EV-FR-10 page:metadata JSON-LD", () => {
	it("EV-FR-10 emits a schema.org Event with offset dates, venue, status and offers", async () => {
		const budget = await setup();
		const e = await entry();
		await save(e.id);
		const r = await budget.invokeHook("page:metadata", page(e.id));
		expectWithinBudget(r, TARGET);
		const ld = graphOf(r.value);
		expect(ld).toMatchObject({
			"@context": "https://schema.org",
			"@type": "Event",
			name: "Summer Fete",
			url: `https://site.test/events/${e.id}`,
			startDate: "2099-07-14T20:00:00+01:00",
			endDate: "2099-07-14T22:00:00+01:00",
			eventStatus: "https://schema.org/EventScheduled",
			eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
			location: { "@type": "Place", name: "Town Hall" },
		});
		expect(ld.offers).toHaveLength(1);
		expect(ld.offers[0]).toMatchObject({
			"@type": "Offer",
			name: "Adult",
			price: "15.00",
			priceCurrency: "GBP",
			availability: "https://schema.org/InStock",
			url: `https://site.test/events/${e.id}`,
		});
	});

	it("EV-FR-10 reports SoldOut and EventCancelled, and never counters or booking data", async () => {
		const budget = await setup();
		const e = await entry();
		await save(e.id, "on_sale", 10);
		await host().fixtures.plugin.storage("event_configs", e.id, { ...(await config(e.id)), reserved: 10 });
		await booking(e.id, "confirmed");
		let ld = graphOf((await budget.invokeHook("page:metadata", page(e.id))).value);
		expect(ld.offers[0]?.availability).toBe("https://schema.org/SoldOut");
		const json = JSON.stringify(ld);
		for (const secret of ["reserved", "sold", "capacity", "ada@example.com", "REF0000001", "hidden", "Secret"]) {
			expect(json).not.toContain(secret);
		}
		await host().fixtures.plugin.storage("event_configs", e.id, { ...(await config(e.id)), status: "cancelled" });
		ld = graphOf((await budget.invokeHook("page:metadata", page(e.id))).value);
		expect(ld.eventStatus).toBe("https://schema.org/EventCancelled");
	});

	it("EV-FR-10 leaves no raw < in any value, so a title cannot close the script tag", async () => {
		const budget = await setup();
		const e = await entry("</script><script>alert(1)</script>", { venue: "A </SCRIPT> hall" });
		await save(e.id);
		const ld = graphOf((await budget.invokeHook("page:metadata", page(e.id))).value);
		expect(JSON.stringify(ld)).not.toContain("<");
		expect(String(ld.name).toLowerCase()).not.toContain("</script");
	});

	it("EV-FR-10 contributes nothing for other collections, plain pages, drafts, unpublished or orphaned events", async () => {
		const budget = await setup();
		const e = await entry();
		await save(e.id);
		const none = async (p: unknown) => expect((await budget.invokeHook("page:metadata", p)).value ?? null).toBeNull();
		await none(page(e.id, "posts"));
		await none({ page: { ...page(e.id).page, content: undefined, kind: "custom" } });
		await none(page("no-config"));
		const base = (await config(e.id)) as Config;
		for (const over of [{ status: "draft" }, { orphaned: true }, { unpublished: true }]) {
			await host().fixtures.plugin.storage("event_configs", e.id, { ...base, ...over });
			await none(page(e.id));
		}
	});
});

describe("EV-FR-10 content hooks", () => {
	it("EV-FR-10 unpublish pauses sales and removes the event from public/events; publish restores both", async () => {
		const budget = await setup();
		const e = await entry();
		await save(e.id);
		const listed = async () =>
			((await budget.invokeRoute("public/events", {})).value as { events: unknown[] }).events.length;
		expect(await listed()).toBe(1);

		await host().actions.content.unpublish("events", e.id);
		expect((await config(e.id))?.unpublished).toBe(true);
		expect(await listed()).toBe(0);
		expect((await budget.invokeRoute("public/event", { eventId: e.id })).value).toMatchObject({ ok: false });
		const reserve = await budget.invokeRoute("public/checkout/reserve", {
			eventId: e.id,
			idempotencyKey: "k".repeat(24),
			buyer: { name: "Ada", email: "ada@example.com" },
			lines: [],
		});
		expect(JSON.stringify(reserve.value)).toContain("NOT_FOUND");

		await host().actions.content.publish("events", e.id);
		expect((await config(e.id))?.unpublished).toBeFalsy();
		expect(await listed()).toBe(1);
	});

	it("EV-FR-10 the publish and unpublish hooks stay within budget and ignore other collections", async () => {
		const budget = await setup();
		const e = await entry();
		await save(e.id);
		const fire = (name: string, event: unknown) => budget.invokeHook(name, event);
		expectWithinBudget(await fire("content:afterUnpublish", { collection: "events", content: { id: e.id } }), TARGET);
		await fire("content:afterPublish", { collection: "posts", content: { id: e.id } });
		expect((await config(e.id))?.unpublished).toBe(true);
		expectWithinBudget(
			await fire("content:afterPublish", {
				collection: "events",
				content: { id: e.id, title: "Summer Fete", starts_at: "2099-07-14T19:00:00Z" },
			}),
			TARGET,
		);
		expect((await config(e.id))?.unpublished).toBeFalsy();
	});

	it("S9 deleting an event with bookings is vetoed with exactly false; the entry stays", async () => {
		const budget = await setup();
		const e = await entry();
		await save(e.id);
		await booking(e.id, "confirmed");
		const veto = await budget.invokeHook("content:beforeDelete", { id: e.id, collection: "events", permanent: false });
		expectWithinBudget(veto, TARGET);
		expect(veto.value).toBe(false);

		await expect(host().actions.content.trash("events", e.id)).resolves.toMatchObject({ success: false });
		expect(await host().inspect.content.get("events", e.id)).not.toBeNull();
	});

	it("S9 a delete is allowed without live bookings, for other collections and after cancelled bookings", async () => {
		const budget = await setup();
		const e = await entry();
		await save(e.id);
		await booking(e.id, "cancelled", "bk_c");
		await booking(e.id, "expired", "bk_x");
		const ask = async (collection: string, id: string) =>
			(await budget.invokeHook("content:beforeDelete", { id, collection, permanent: false })).value;
		expect(await ask("events", e.id)).not.toBe(false);
		expect(await ask("posts", e.id)).not.toBe(false);
		expect(await ask("events", "plain-page")).not.toBe(false);
	});

	it("S9 afterDelete orphans the config and hides the event, even with bookings (permanent delete)", async () => {
		const budget = await setup();
		const e = await entry();
		await save(e.id);
		await booking(e.id, "confirmed");
		expectWithinBudget(
			await budget.invokeHook("content:afterDelete", { id: e.id, collection: "events", permanent: true }),
			TARGET,
		);
		expect((await config(e.id))?.orphaned).toBe(true);
		expect(((await budget.invokeRoute("public/events", {})).value as { events: unknown[] }).events).toEqual([]);
		await budget.invokeHook("content:afterDelete", { id: "x", collection: "posts", permanent: true });
	});
});
