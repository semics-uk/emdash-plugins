import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

import { PUBLIC_ROUTES } from "../src/routes/public";

// public/events and public/event (EV-FR-03, T046), plus the copy of the entry's public info that
// readers use (content:afterSave, config/save) against the real plugin in workerd.

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const host = () => runtime as PluginRuntimeTestHost;
const TARGET = { calls: 8 };

type Info = { title: string; startsAt: string; endsAt: string | null; timezone: string | null; venue: string | null };
type Config = { status: string; reserved: number; info?: Info | null };

const FIELDS = [
	{ slug: "title", label: "Title", type: "string" },
	{ slug: "starts_at", label: "Starts", type: "datetime" },
	{ slug: "ends_at", label: "Ends", type: "datetime" },
	{ slug: "timezone", label: "Timezone", type: "string" },
	{ slug: "venue", label: "Venue", type: "string" },
] as const;

async function entry(title: string, over: Record<string, unknown> = {}) {
	return host().fixtures.content("events", {
		slug: title.toLowerCase().replaceAll(" ", "-"),
		status: "published",
		data: {
			title,
			starts_at: "2099-11-14T19:00:00.000Z",
			ends_at: "2099-11-14T21:00:00.000Z",
			timezone: "Europe/London",
			venue: "Town Hall",
			...over,
		},
	});
}

async function save(eventId: string, status = "on_sale", over: Record<string, unknown> = {}) {
	const r = (await host().transport.invokeRoute("config/save", {
		eventId,
		config: { status, capacity: 50, currency: "GBP" },
		ticketTypes: [
			{ name: "Adult", priceMinor: 1500, capacity: 30, maxPerOrder: 6 },
			{ name: "Child", priceMinor: 500, capacity: 10, sort: 1 },
			{ name: "Secret", priceMinor: 100, capacity: 5, sort: 2, hidden: true },
		],
		occurrences: [],
		...over,
	})) as { ok: boolean };
	expect(r.ok).toBe(true);
}

async function setup() {
	runtime = await createPluginRuntimeTestHost({ site: { name: "Town Hall", url: "https://site.test" } });
	await runtime.fixtures.collection({ slug: "events", label: "Events", fields: [...FIELDS] });
	return withBudget(runtime);
}

const config = (id: string) => host().inspect.storage.get<Config>("event_configs", id);

describe("EV-FR-03 public/events", () => {
	it("EV-FR-03 declares GET with a 60 s cache", () => {
		expect(PUBLIC_ROUTES["public/events"]).toMatchObject({
			methods: ["GET"],
			public: true,
			cacheControl: "public, max-age=60, stale-while-revalidate=300",
		});
	});

	it("EV-FR-03 lists on-sale events by start with price and availability, leaving out drafts", async () => {
		const budget = await setup();
		const later = await entry("Later Gig", { starts_at: "2099-12-01T19:00:00.000Z", ends_at: null });
		const sooner = await entry("Sooner Gig");
		const draft = await entry("Hidden Gig");
		await save(later.id);
		await save(sooner.id);
		await save(draft.id, "draft");

		const r = await budget.invokeRoute("public/events", {});
		expectWithinBudget(r, { calls: 2 });
		const body = r.value as { ok: boolean; events: Array<Record<string, unknown>> };
		expect(body.ok).toBe(true);
		expect(body.events.map((e) => e.title)).toEqual(["Sooner Gig", "Later Gig"]);
		expect(body.events[0]).toEqual({
			eventId: sooner.id,
			title: "Sooner Gig",
			status: "on_sale",
			startsAt: "2099-11-14T19:00:00.000Z",
			endsAt: "2099-11-14T21:00:00.000Z",
			timezone: "Europe/London",
			venue: "Town Hall",
			currency: "GBP",
			priceFromMinor: 500,
			available: 50,
		});
	});

	it("EV-FR-03 leaves out an orphaned event", async () => {
		const budget = await setup();
		const e = await entry("Gone Gig");
		await save(e.id);
		await host().fixtures.plugin.storage("event_configs", e.id, { ...(await config(e.id)), orphaned: true });
		const body = (await budget.invokeRoute("public/events", {})).value as { events: unknown[] };
		expect(body.events).toEqual([]);
	});

	it("EV-FR-03 shows no private fields", async () => {
		const budget = await setup();
		const e = await entry("Private Check");
		await save(e.id);
		const json = JSON.stringify((await budget.invokeRoute("public/events", {})).value);
		for (const secret of ["reserved", "sold", "catalog", "salesStart", "questions", "signature", "waitlist", "hidden"]) {
			expect(json).not.toContain(secret);
		}
	});
});

describe("EV-FR-03 public/event", () => {
	it("EV-FR-03 answers in the PublicEvent shape: visible ticket types with seats left", async () => {
		const budget = await setup();
		const e = await entry("Winter Concert");
		await save(e.id);
		await host().actions.plugin.updateSettings({ turnstileSiteKey: "0x4AAAA-site" });

		const r = await budget.invokeRoute("public/event", { eventId: e.id });
		expectWithinBudget(r, TARGET);
		const body = r.value as Record<string, unknown> & { ticketTypes: Array<Record<string, unknown>> };
		expect(body).toMatchObject({
			ok: true,
			eventId: e.id,
			title: "Winter Concert",
			status: "on_sale",
			currency: "GBP",
			timezone: "Europe/London",
			turnstileSiteKey: "0x4AAAA-site",
		});
		expect(body.ticketTypes.map((t) => [t.name, t.priceMinor, t.available, t.maxPerOrder ?? null])).toEqual([
			["Adult", 1500, 30, 6],
			["Child", 500, 10, null],
		]);
		expect(typeof body.ticketTypes[0]?.id).toBe("string");
		expect(body.occurrences ?? []).toEqual([]);
	});

	it("EV-FR-03 availability reflects the reserved counters, capped by the event's own seats", async () => {
		const budget = await setup();
		const e = await entry("Counted");
		await save(e.id, "on_sale", {
			config: { status: "on_sale", capacity: 12, currency: "GBP" },
			occurrences: [{ startsAt: "2099-11-20T18:00:00Z", endsAt: "2099-11-20T20:00:00Z", capacity: 8 }],
		});
		const loaded = (await host().transport.invokeRoute("config/get", { eventId: e.id })) as {
			ticketTypes: Array<{ id: string; name: string }>;
			occurrences: Array<{ id: string }>;
		};
		const adult = loaded.ticketTypes.find((t) => t.name === "Adult")?.id as string;
		const occ = loaded.occurrences[0]?.id as string;
		const reserved = await budget.invokeRoute("public/checkout/reserve", {
			eventId: e.id,
			occurrenceId: occ,
			lines: [{ ticketTypeId: adult, qty: 5 }],
			buyer: { name: "Ada Lovelace", email: "ada@example.com" },
			idempotencyKey: `key-${"x".repeat(40)}`,
		});
		expect((reserved.value as { ok: boolean }).ok).toBe(true);

		const body = (await budget.invokeRoute("public/event", { eventId: e.id })).value as {
			ticketTypes: Array<{ name: string; available: number }>;
			occurrences: Array<{ id: string; startsAt: string; endsAt: string; available: number }>;
		};
		// Adult: 30 seats, 5 held, but only 12 - 5 = 7 left on the event.
		expect(Object.fromEntries(body.ticketTypes.map((t) => [t.name, t.available]))).toEqual({ Adult: 7, Child: 7 });
		expect(body.occurrences).toEqual([
			{ id: occ, startsAt: "2099-11-20T18:00:00.000Z", endsAt: "2099-11-20T20:00:00.000Z", available: 3 },
		]);
		const listing = (await budget.invokeRoute("public/events", {})).value as { events: Array<{ available: number }> };
		expect(listing.events[0]?.available).toBe(7);
	});

	it("EV-FR-03 reports sold out as zero seats and never negative", async () => {
		const budget = await setup();
		const e = await entry("Full");
		await save(e.id);
		await host().fixtures.plugin.storage("event_configs", e.id, { ...(await config(e.id)), reserved: 999 });
		const body = (await budget.invokeRoute("public/event", { eventId: e.id })).value as {
			ticketTypes: Array<{ available: number }>;
		};
		expect(body.ticketTypes.map((t) => t.available)).toEqual([0, 0]);
	});

	it("EV-FR-03 answers NOT_FOUND for a draft, an unknown or a malformed event, revealing nothing", async () => {
		const budget = await setup();
		const e = await entry("Draft Gig");
		await save(e.id, "draft");
		const answers = await Promise.all(
			[e.id, "nope", "", undefined].map(async (eventId) => (await budget.invokeRoute("public/event", { eventId })).value),
		);
		for (const a of answers) expect(a).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
		expect(new Set(answers.map((a) => JSON.stringify(a))).size).toBe(1);
	});

	it("EV-FR-03 shows no private fields or booking data", async () => {
		const budget = await setup();
		const e = await entry("Private Check");
		await save(e.id);
		const json = JSON.stringify((await budget.invokeRoute("public/event", { eventId: e.id })).value);
		for (const secret of ["reserved", "sold", "catalog", "Secret", "hidden", "questions", "signature", "booking"]) {
			expect(json).not.toContain(secret);
		}
	});
});

describe("EV-FR-08 the copy of the entry's public info", () => {
	it("config/save copies it from the entry, through the mapping settings", async () => {
		await setup();
		await host().actions.plugin.updateSettings({ fieldStartsAt: "starts_at", fieldVenue: "venue" });
		const e = await entry("Mapped");
		await save(e.id);
		expect((await config(e.id))?.info).toEqual({
			title: "Mapped",
			startsAt: "2099-11-14T19:00:00.000Z",
			endsAt: "2099-11-14T21:00:00.000Z",
			timezone: "Europe/London",
			venue: "Town Hall",
		});
	});

	it("content:afterSave refreshes it for the events collection within budget", async () => {
		const budget = await setup();
		const e = await entry("Before");
		await save(e.id);
		const r = await budget.invokeHook("content:afterSave", {
			collection: "events",
			isNew: false,
			content: { id: e.id, title: "After", starts_at: "2099-12-24T10:00:00Z", ends_at: null, timezone: "UTC", venue: "Hall B" },
		});
		expectWithinBudget(r, { calls: 3 });
		expect((await config(e.id))?.info).toEqual({
			title: "After",
			startsAt: "2099-12-24T10:00:00.000Z",
			endsAt: null,
			timezone: "UTC",
			venue: "Hall B",
		});
		// The copy is what the public routes serve.
		const body = (await budget.invokeRoute("public/event", { eventId: e.id })).value as { title: string; timezone: string };
		expect([body.title, body.timezone]).toEqual(["After", "UTC"]);
	});

	it("content:afterSave ignores other collections, entries without a config and entries without a start", async () => {
		const budget = await setup();
		const e = await entry("Stable");
		await save(e.id);
		const before = (await config(e.id))?.info;
		const fire = (collection: string, id: string, content: Record<string, unknown>) =>
			budget.invokeHook("content:afterSave", { collection, isNew: false, content: { id, ...content } });
		await fire("posts", e.id, { title: "Other", starts_at: "2099-01-01T00:00:00Z" });
		await fire("events", "no-config", { title: "Other", starts_at: "2099-01-01T00:00:00Z" });
		await fire("events", e.id, { title: "No start" });
		expect((await config(e.id))?.info).toEqual(before);
		expect(await config("no-config")).toBeNull();
	});
});
