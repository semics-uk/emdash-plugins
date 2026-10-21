import { createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Runs against tests/fixtures/inventory-probe (vitest.config.ts, project "inventory"): the shipped
// manifest on D1, with probe routes that drive src/domain/inventory.ts from inside the sandbox.

let host: PluginTestHost;
beforeEach(async () => {
	host = await createPluginTestHost();
});
afterEach(async () => {
	await host.dispose();
});

/** Designs target ≤ 8 bridge calls so a log or email call never tips a route over 10 (R22). */
const TARGET = { calls: 8 };

type Reply = { ok: boolean; code?: string; collection?: string; id?: string; uncompensated?: unknown[] };
type Line = { ticketTypeId: string; qty: number };
type Counted = { capacity: number; reserved: number; sold: number };

const seed = (collection: string, items: Array<{ id: string; data: Record<string, unknown> }>) =>
	host.invokeRoute("probe/seed", { collection, items });

const c = (capacity: number, reserved = 0, sold = 0) => ({ capacity, reserved, sold });

async function seedEvent(opts: { event: number; occurrence?: number; types: Record<string, number> }) {
	await seed("event_configs", [{ id: "e1", data: { status: "on_sale", currency: "GBP", ...c(opts.event) } }]);
	if (opts.occurrence !== undefined) {
		await seed("occurrences", [
			{
				id: "occ_1",
				data: { eventId: "e1", startsAt: "2026-12-05T18:00:00.000Z", status: "open", ...c(opts.occurrence) },
			},
		]);
	}
	await seed(
		"ticket_types",
		Object.entries(opts.types).map(([id, capacity]) => ({
			id,
			data: { eventId: "e1", name: id, priceMinor: 1000, hidden: false, sort: 0, ...c(capacity) },
		})),
	);
}

const read = async (collection: string, id: string) => (await host.storage<Counted>(collection).get(id)) as Counted;

/**
 * Run every request concurrently, at most `width` in flight: each still races the others, but a
 * loaded machine cannot queue one past the host's 30 s per-invocation wall-time limit (50 in flight
 * timed out at load ~9; 16 still interleaves every step of every reservation).
 */
async function parallel(inputs: unknown[], width = 16): Promise<Reply[]> {
	const out: Reply[] = new Array(inputs.length);
	let next = 0;
	const lane = async () => {
		while (next < inputs.length) {
			const i = next++;
			out[i] = (await host.invokeRoute("probe/reserve", inputs[i])) as Reply;
		}
	};
	await Promise.all(Array.from({ length: width }, lane));
	return out;
}

/** Small deterministic PRNG (mulberry32), so a failing property run can be replayed. */
function rng(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

describe("inventory on D1 (EV-FR-04, EV-NFR-03, R3)", () => {
	it("EV-NFR-03 200 parallel reservations never exceed capacity, with injected failures compensated", async () => {
		const caps = { tt_a: 30, tt_b: 25, tt_c: 20 };
		await seedEvent({ event: 70, occurrence: 60, types: caps });
		const random = rng(44);
		const ids = Object.keys(caps);
		const requests = Array.from({ length: 200 }, () => {
			const lines: Line[] = ids
				.filter(() => random() < 0.5)
				.slice(0, 2)
				.map((ticketTypeId) => ({ ticketTypeId, qty: 1 + Math.floor(random() * 3) }));
			if (lines.length === 0) lines.push({ ticketTypeId: ids[Math.floor(random() * 3)] as string, qty: 1 });
			// One in five requests fails at a random forward step (1 = first ticket type).
			const failAt = random() < 0.2 ? 1 + Math.floor(random() * (lines.length + 2)) : undefined;
			// Two ticket types + occurrence + event is 4 steps (7 calls worst case): over the 8-call
			// target with the 3 reads, inside the hard limit of 10. This test is about correctness.
			return { eventId: "e1", occurrenceId: "occ_1", lines, failAt, maxCalls: 7 };
		});
		const replies = await parallel(requests);

		const expected: Record<string, number> = { e1: 0, occ_1: 0, tt_a: 0, tt_b: 0, tt_c: 0 };
		replies.forEach((reply, i) => {
			expect(reply.uncompensated ?? []).toEqual([]);
			if (!reply.ok) {
				expect(["SOLD_OUT", "INTERNAL"]).toContain(reply.code);
				return;
			}
			for (const line of requests[i]?.lines ?? []) {
				expected[line.ticketTypeId] = (expected[line.ticketTypeId] ?? 0) + line.qty;
				expected.occ_1 = (expected.occ_1 ?? 0) + line.qty;
				expected.e1 = (expected.e1 ?? 0) + line.qty;
			}
		});
		const event = await read("event_configs", "e1");
		const occurrence = await read("occurrences", "occ_1");
		expect(event.reserved).toBe(expected.e1);
		expect(occurrence.reserved).toBe(expected.occ_1);
		expect(event.reserved).toBeLessThanOrEqual(70);
		expect(occurrence.reserved).toBeLessThanOrEqual(60);
		for (const [id, cap] of Object.entries(caps)) {
			const tt = await read("ticket_types", id);
			expect(tt.reserved).toBe(expected[id]);
			expect(tt.reserved).toBeLessThanOrEqual(cap);
		}
		// The run actually contended: some succeeded, some sold out, some hit an injected failure.
		expect(replies.filter((r) => r.ok).length).toBeGreaterThan(10);
		expect(replies.filter((r) => r.code === "SOLD_OUT").length).toBeGreaterThan(10);
		expect(replies.filter((r) => r.code === "INTERNAL").length).toBeGreaterThan(0);
	});

	it("EV-NFR-03 with one binding counter, 200 parallel single-seat requests sell exactly its capacity", async () => {
		await seedEvent({ event: 1000, types: { tt_a: 50 } });
		const replies = await parallel(
			Array.from({ length: 200 }, () => ({ eventId: "e1", lines: [{ ticketTypeId: "tt_a", qty: 1 }] })),
		);
		expect(replies.filter((r) => r.ok)).toHaveLength(50);
		expect(replies.filter((r) => r.code === "SOLD_OUT")).toHaveLength(150);
		expect((await read("ticket_types", "tt_a")).reserved).toBe(50);
		expect((await read("event_configs", "e1")).reserved).toBe(50);
	});

	it("R3 injected failure between steps leaves counters unchanged after compensation, within budget", async () => {
		await seedEvent({ event: 70, occurrence: 60, types: { tt_a: 30 } });
		const budget = withBudget(host);
		// Three steps (ticket type → occurrence → event); failing the last is the worst case:
		// 3 reads + 3 reservation calls + 2 compensations = 8.
		for (const failAt of [1, 2, 3]) {
			const r = await budget.invokeRoute("probe/reserve", {
				eventId: "e1",
				occurrenceId: "occ_1",
				lines: [{ ticketTypeId: "tt_a", qty: 2 }],
				failAt,
			});
			expectWithinBudget(r, TARGET);
			expect(r.value).toMatchObject({ ok: false, code: "INTERNAL", uncompensated: [] });
		}
		for (const [collection, id] of [
			["ticket_types", "tt_a"],
			["occurrences", "occ_1"],
			["event_configs", "e1"],
		] as const) {
			expect((await read(collection, id)).reserved).toBe(0);
		}
	});

	it("EV-FR-04 sold out returns SOLD_OUT within budget, and a reservation fits it too", async () => {
		await seedEvent({ event: 10, occurrence: 10, types: { tt_a: 5, tt_b: 5 } });
		const budget = withBudget(host);
		const ok = await budget.invokeRoute("probe/reserve", {
			eventId: "e1",
			occurrenceId: "occ_1",
			lines: [{ ticketTypeId: "tt_b", qty: 4 }],
		});
		expectWithinBudget(ok, TARGET);
		expect(ok.value).toMatchObject({ ok: true });
		const soldOut = await budget.invokeRoute("probe/reserve", {
			eventId: "e1",
			occurrenceId: "occ_1",
			lines: [{ ticketTypeId: "tt_b", qty: 2 }],
		});
		expectWithinBudget(soldOut, TARGET);
		expect(soldOut.value).toMatchObject({ ok: false, code: "SOLD_OUT", collection: "ticket_types", id: "tt_b" });
		// The answer came from the documents read: no counter write was attempted.
		expect(soldOut.calls.filter((call) => call.method === "updateIf")).toEqual([]);
		expect((await read("event_configs", "e1")).reserved).toBe(4);
	});

	it("EV-NFR-03 an order whose worst case would break the 8-call target is refused before any write", async () => {
		await seedEvent({ event: 10, occurrence: 10, types: { tt_a: 5, tt_b: 5 } });
		const budget = withBudget(host);
		const r = await budget.invokeRoute("probe/reserve", {
			eventId: "e1",
			occurrenceId: "occ_1",
			lines: [
				{ ticketTypeId: "tt_a", qty: 1 },
				{ ticketTypeId: "tt_b", qty: 1 },
			],
		});
		expectWithinBudget(r, TARGET);
		expect(r.value).toMatchObject({ ok: false, code: "BAD_REQUEST", reason: "TOO_MANY_LINES" });
		expect(r.calls.filter((call) => call.method === "updateIf")).toEqual([]);
	});

	it("R3 drift repair recomputes reserved (and sold) from live bookings within budget", async () => {
		await seedEvent({ event: 100, occurrence: 50, types: { tt_a: 30, tt_b: 30 } });
		// Counters drifted, as after a crashed invocation.
		await seed("ticket_types", [
			{ id: "tt_a", data: { eventId: "e1", name: "A", priceMinor: 0, hidden: false, sort: 0, ...c(30, 12, 0) } },
		]);
		await seed("occurrences", [
			{ id: "occ_1", data: { eventId: "e1", startsAt: "2026-12-05T18:00:00.000Z", status: "open", ...c(50, 40, 0) } },
		]);
		const booking = (ref: string, status: string, lines: Line[], createdAt = "2026-11-01T10:00:00.000Z") => ({
			id: ref,
			data: {
				ref,
				eventId: "e1",
				occurrenceId: "occ_1",
				status,
				email: "a@example.com",
				createdAt,
				lines: lines.map((l) => ({ ...l, unitPriceMinor: 0 })),
			},
		});
		await seed("bookings", [
			booking("B1", "held", [{ ticketTypeId: "tt_a", qty: 2 }]),
			booking("B2", "confirmed", [
				{ ticketTypeId: "tt_a", qty: 1 },
				{ ticketTypeId: "tt_b", qty: 3 },
			]),
			booking("B3", "expired", [{ ticketTypeId: "tt_b", qty: 5 }]),
			booking("B4", "cancelled", [{ ticketTypeId: "tt_a", qty: 5 }]),
			// A draft from a few seconds ago may be mid-reservation, so it still counts.
			booking("B5", "draft", [{ ticketTypeId: "tt_b", qty: 1 }], "2026-11-01T11:59:50.000Z"),
		]);
		const budget = withBudget(host);
		const r = await budget.invokeRoute("probe/repair", { eventId: "e1", now: "2026-11-01T12:00:00.000Z" });
		expectWithinBudget(r, TARGET);
		expect(r.value).toMatchObject({ complete: true, conflicted: [], pending: [] });
		expect(await read("ticket_types", "tt_a")).toMatchObject({ reserved: 3, sold: 1 });
		expect(await read("ticket_types", "tt_b")).toMatchObject({ reserved: 4, sold: 3 });
		expect(await read("occurrences", "occ_1")).toMatchObject({ reserved: 7, sold: 4 });
		expect(await read("event_configs", "e1")).toMatchObject({ reserved: 7, sold: 4 });
	});
});

describe("config/save leaves counters to the inventory module (EV-FR-03, R3)", () => {
	const config = { status: "on_sale", capacity: 100, currency: "GBP" };

	async function savedTicketType() {
		const first = (await host.invokeRoute("config/save", {
			eventId: "e1",
			config,
			ticketTypes: [{ name: "Standard", priceMinor: 1500, capacity: 60 }],
		})) as { ok: boolean };
		expect(first.ok).toBe(true);
		const list = await host.storage<Counted>("ticket_types").list();
		return list[0]?.id as string;
	}

	it("R3 a reservation committed between config/save's read and its write is not lost", async () => {
		const id = await savedTicketType();
		const r = (await host.invokeRoute("probe/config-save-race", {
			input: {
				eventId: "e1",
				config: { ...config, capacity: 90 },
				ticketTypes: [{ id, name: "Std", priceMinor: 1500, capacity: 60 }],
			},
			race: { eventId: "e1", lines: [{ ticketTypeId: id, qty: 3 }] },
		})) as { saved: { ok: boolean }; raced: Reply };
		expect(r.raced).toMatchObject({ ok: true });
		expect(r.saved).toMatchObject({ ok: true });
		expect(await read("ticket_types", id)).toMatchObject({ name: "Std", capacity: 60, reserved: 3 });
		expect(await read("event_configs", "e1")).toMatchObject({ capacity: 90, reserved: 3 });
	});

	it("EV-FR-03 a capacity cut that a concurrent reservation makes invalid is refused, not applied", async () => {
		const id = await savedTicketType();
		const r = (await host.invokeRoute("probe/config-save-race", {
			input: { eventId: "e1", config, ticketTypes: [{ id, name: "Standard", priceMinor: 1500, capacity: 2 }] },
			race: { eventId: "e1", lines: [{ ticketTypeId: id, qty: 3 }] },
		})) as { saved: { ok: boolean; issues?: unknown[] }; raced: Reply };
		expect(r.raced).toMatchObject({ ok: true });
		expect(r.saved).toMatchObject({
			ok: false,
			issues: [{ path: "ticketTypes[0].capacity", code: "CAPACITY_BELOW_RESERVED" }],
		});
		expect(await read("ticket_types", id)).toMatchObject({ capacity: 60, reserved: 3 });
	});

	it("EV-FR-03 a ticket type that takes a reservation while being dropped is kept", async () => {
		const id = await savedTicketType();
		const r = (await host.invokeRoute("probe/config-save-race", {
			input: { eventId: "e1", config, ticketTypes: [] },
			race: { eventId: "e1", lines: [{ ticketTypeId: id, qty: 1 }] },
		})) as { saved: { ok: boolean; issues?: unknown[] }; raced: Reply };
		expect(r.raced).toMatchObject({ ok: true });
		expect(r.saved).toMatchObject({ ok: false, issues: [{ path: "ticketTypes", code: "ITEM_IN_USE" }] });
		expect(await read("ticket_types", id)).toMatchObject({ capacity: 60, reserved: 1 });
	});
});
