import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

type Body = {
	ok: boolean;
	error?: { code: string };
	issues?: Array<{ path: string; code: string }>;
	config?: { capacity: number; reserved: number; status: string };
	ticketTypes?: Array<{ id: string; name: string; priceMinor: number; capacity: number; reserved: number }>;
	occurrences?: Array<{ id: string; startsAt: string; capacity: number }>;
};

const input = {
	eventId: "entry_1",
	config: { status: "on_sale", capacity: 100, currency: "GBP" },
	ticketTypes: [
		{ name: "Standard", priceMinor: 1500, capacity: 60 },
		{ name: "VIP", priceMinor: 4000, capacity: 10, sort: 1 },
	],
	occurrences: [
		{ startsAt: "2026-12-05T18:00:00Z", endsAt: "2026-12-05T22:00:00Z", capacity: 50 },
		{ startsAt: "2026-12-06T18:00:00Z", endsAt: "2026-12-07T10:00:00Z", capacity: 50 },
	],
};

async function setup() {
	runtime = await createPluginRuntimeTestHost();
	return { runtime, budget: withBudget(runtime) };
}

describe("private config routes (EV-FR-02, EV-FR-03)", () => {
	it("EV-FR-02 saves and loads a config, ticket types and occurrences within budget", async () => {
		const { budget } = await setup();
		const saved = await budget.invokeRoute("config/save", input);
		expectWithinBudget(saved);
		expect((saved.value as Body).ok).toBe(true);
		const loaded = await budget.invokeRoute("config/get", { eventId: "entry_1" });
		expectWithinBudget(loaded);
		const body = loaded.value as Body;
		expect(body.config).toMatchObject({ status: "on_sale", capacity: 100, reserved: 0 });
		expect(body.ticketTypes?.map((t) => [t.name, t.priceMinor, t.capacity])).toEqual([
			["Standard", 1500, 60],
			["VIP", 4000, 10],
		]);
		expect(body.occurrences?.map((o) => o.startsAt)).toEqual(["2026-12-05T18:00:00.000Z", "2026-12-06T18:00:00.000Z"]);
	});

	it("EV-FR-02 updating by id keeps ids, and dropping an idle ticket type deletes it", async () => {
		const { budget } = await setup();
		await budget.invokeRoute("config/save", input);
		const first = (await budget.invokeRoute("config/get", { eventId: "entry_1" })).value as Body;
		const [std] = first.ticketTypes ?? [];
		const update = await budget.invokeRoute("config/save", {
			...input,
			ticketTypes: [{ id: std?.id, name: "Standard+", priceMinor: 1600, capacity: 60 }],
			occurrences: first.occurrences,
		});
		expectWithinBudget(update);
		expect((update.value as Body).ok).toBe(true);
		const after = (await budget.invokeRoute("config/get", { eventId: "entry_1" })).value as Body;
		expect(after.ticketTypes).toHaveLength(1);
		expect(after.ticketTypes?.[0]).toMatchObject({ id: std?.id, name: "Standard+", priceMinor: 1600 });
		expect(after.occurrences).toHaveLength(2);
	});

	it("EV-FR-02 clearing an optional field on a stored document stores null, read back as absent", async () => {
		const { budget } = await setup();
		await budget.invokeRoute("config/save", {
			...input,
			config: { ...input.config, salesEnd: "2026-12-01T10:00:00Z" },
		});
		const first = (await budget.invokeRoute("config/get", { eventId: "entry_1" })).value as Body;
		expect(first.config).toMatchObject({ salesEnd: "2026-12-01T10:00:00.000Z" });
		const cleared = await budget.invokeRoute("config/save", {
			...input,
			ticketTypes: first.ticketTypes,
			occurrences: first.occurrences,
		});
		expectWithinBudget(cleared, { calls: 8 });
		expect((cleared.value as Body).ok).toBe(true);
		const after = (await budget.invokeRoute("config/get", { eventId: "entry_1" })).value as Body;
		expect((after.config as { salesEnd?: unknown }).salesEnd ?? null).toBeNull();
		// An unchanged resubmission writes nothing beyond the three reads.
		const again = await budget.invokeRoute("config/save", {
			...input,
			ticketTypes: after.ticketTypes,
			occurrences: after.occurrences,
		});
		expect((again.value as Body).ok).toBe(true);
		expect(again.calls.map((c) => c.method)).toEqual(expect.arrayContaining(["get", "query", "query"]));
		expect(again.calls).toHaveLength(3);
	});

	it("EV-NFR-03 a save that would need more than 8 bridge calls is refused before writing", async () => {
		const { budget } = await setup();
		const many = Array.from({ length: 6 }, (_, i) => ({ startsAt: `2026-12-0${i + 1}T18:00:00Z`, capacity: 50 }));
		await budget.invokeRoute("config/save", { ...input, occurrences: many });
		const first = (await budget.invokeRoute("config/get", { eventId: "entry_1" })).value as Body;
		const r = await budget.invokeRoute("config/save", {
			...input,
			ticketTypes: first.ticketTypes,
			occurrences: first.occurrences?.map((o) => ({ ...o, capacity: 40 })),
		});
		expectWithinBudget(r, { calls: 8 });
		expect(r.value).toMatchObject({ ok: false, issues: [{ path: "input", code: "TOO_MANY_CHANGES" }] });
		const after = (await budget.invokeRoute("config/get", { eventId: "entry_1" })).value as Body;
		expect(after.occurrences?.map((o) => o.capacity)).toEqual([50, 50, 50, 50, 50, 50]);
	});

	it("EV-FR-02 rejects invalid input with codes and writes nothing", async () => {
		const { budget } = await setup();
		const bad = await budget.invokeRoute("config/save", {
			...input,
			ticketTypes: [{ name: "Standard", priceMinor: -5, capacity: 60 }],
		});
		expectWithinBudget(bad);
		expect(bad.value).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST" },
			issues: [{ path: "ticketTypes[0].priceMinor", code: "INVALID_PRICE" }],
		});
		const loaded = await budget.invokeRoute("config/get", { eventId: "entry_1" });
		expectWithinBudget(loaded);
		expect(loaded.value).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
	});

	it("EV-FR-02 rejects a missing event id", async () => {
		const { budget } = await setup();
		for (const name of ["config/save", "config/get"]) {
			const r = await budget.invokeRoute(name, { config: input.config });
			expectWithinBudget(r);
			expect(r.value).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
		}
	});

	it("EV-FR-03 refuses to lower capacity below reserved", async () => {
		const { runtime, budget } = await setup();
		await budget.invokeRoute("config/save", input);
		const loaded = (await budget.invokeRoute("config/get", { eventId: "entry_1" })).value as Body;
		const std = loaded.ticketTypes?.find((t) => t.name === "Standard");
		// Reservations are written by the inventory module; simulate one directly in storage.
		await runtime.fixtures.plugin.storage("ticket_types", std?.id ?? "", {
			...std,
			eventId: "entry_1",
			sold: 0,
			hidden: false,
			sort: 0,
			reserved: 25,
		});
		const withCapacity = (capacity: number) => ({
			...input,
			ticketTypes: loaded.ticketTypes?.map((t) => ({ ...t, capacity: t.name === "Standard" ? capacity : t.capacity })),
			occurrences: loaded.occurrences,
		});
		const lowered = await budget.invokeRoute("config/save", withCapacity(24));
		expectWithinBudget(lowered);
		expect(lowered.value).toMatchObject({
			ok: false,
			issues: [{ path: "ticketTypes[0].capacity", code: "CAPACITY_BELOW_RESERVED" }],
		});
		const same = await budget.invokeRoute("config/save", withCapacity(25));
		expectWithinBudget(same);
		expect((same.value as Body).ok).toBe(true);
	});

	it("R22 keeps a catalog of ticket types and occurrences on the config for checkout, matching the documents", async () => {
		const { runtime, budget } = await setup();
		await budget.invokeRoute("config/save", input);
		type Catalog = {
			ticketTypes: Record<string, { capacity: number; priceMinor: number; hidden: boolean }>;
			occurrences: Record<string, { capacity: number; startsAt: string; status: string }>;
		};
		const catalog = async () =>
			(await runtime.inspect.storage.get<{ catalog: Catalog }>("event_configs", "entry_1"))?.catalog;
		const loaded = (await budget.invokeRoute("config/get", { eventId: "entry_1" })).value as Body;
		expect(loaded.config).not.toHaveProperty("catalog");
		const ids = Object.fromEntries((loaded.ticketTypes ?? []).map((t) => [t.name, t.id]));
		expect((await catalog())?.ticketTypes).toEqual({
			[ids.Standard ?? ""]: expect.objectContaining({ capacity: 60, priceMinor: 1500, hidden: false }),
			[ids.VIP ?? ""]: expect.objectContaining({ capacity: 10, priceMinor: 4000, hidden: false }),
		});
		expect(Object.values((await catalog())?.occurrences ?? {}).map((o) => [o.startsAt, o.capacity, o.status])).toEqual([
			["2026-12-05T18:00:00.000Z", 50, "open"],
			["2026-12-06T18:00:00.000Z", 50, "open"],
		]);

		// An edit that only touches a ticket type still refreshes the catalog; a deleted type leaves it.
		const edit = await budget.invokeRoute("config/save", {
			...input,
			ticketTypes: [{ id: ids.Standard, name: "Standard", priceMinor: 1600, capacity: 55 }],
			occurrences: loaded.occurrences,
		});
		expectWithinBudget(edit);
		expect((edit.value as Body).ok).toBe(true);
		expect((await catalog())?.ticketTypes).toEqual({
			[ids.Standard ?? ""]: expect.objectContaining({ capacity: 55, priceMinor: 1600 }),
		});

		// A refused capacity cut leaves the catalog matching what is stored.
		const std = await runtime.inspect.storage.get<Record<string, unknown>>("ticket_types", ids.Standard ?? "");
		await runtime.fixtures.plugin.storage("ticket_types", ids.Standard ?? "", { ...std, reserved: 30 });
		const cut = await budget.invokeRoute("config/save", {
			...input,
			config: { ...input.config, capacity: 90 },
			ticketTypes: [{ id: ids.Standard, name: "Standard", priceMinor: 1700, capacity: 20 }],
			occurrences: loaded.occurrences,
		});
		expectWithinBudget(cut);
		expect(cut.value).toMatchObject({ ok: false, issues: [{ code: "CAPACITY_BELOW_RESERVED" }] });
		const stored = await runtime.inspect.storage.get<{ capacity: number; priceMinor: number }>(
			"ticket_types",
			ids.Standard ?? "",
		);
		expect((await catalog())?.ticketTypes[ids.Standard ?? ""]).toMatchObject({
			capacity: stored?.capacity,
			priceMinor: stored?.priceMinor,
		});
	});
});
