import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// The shipped plugin in workerd: the `retention` cron task pages through the real query operators
// (range filters, cursors) within the bridge budget (EV-FR-20, R22).

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const DAY = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

describe("retention in the shipped plugin (EV-FR-20, R22)", () => {
	it("EV-FR-20 erases old personal data over several ticks, within budget, and keeps counts", async () => {
		runtime = await createPluginRuntimeTestHost();
		const r = runtime;
		const budget = withBudget(r);
		await r.fixtures.plugin.storage("event_configs", "ev_old", {
			status: "closed",
			capacity: 10,
			reserved: 3,
			sold: 3,
			currency: "GBP",
			info: { title: "Old", startsAt: ago(500), endsAt: ago(499), timezone: null, venue: null },
		});
		const booking = (n: number, createdAt: string, extra: Record<string, unknown> = {}) => ({
			ref: `REF${n}`,
			eventId: "ev_old",
			status: "confirmed",
			email: `p${n}@example.com`,
			buyer: { name: `Person ${n}`, email: `p${n}@example.com` },
			lines: [{ ticketTypeId: "tt", qty: 1, unitPriceMinor: 0 }],
			totals: { subtotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: "GBP" },
			answers: {},
			accessTokenHash: "h",
			ipHash: "ip",
			createdAt,
			...extra,
		});
		for (let n = 1; n <= 12; n++) await r.fixtures.plugin.storage("bookings", `b${n}`, booking(n, ago(520 - n)));
		await r.fixtures.plugin.storage("bookings", "recent", booking(99, ago(2), { eventId: "ev_new" }));
		await r.fixtures.plugin.storage("attendees", "b1-1", {
			bookingId: "b1",
			eventId: "ev_old",
			ticketTypeId: "tt",
			name: "Ada",
			email: "ada@example.com",
			code: "C1",
			status: "valid",
		});
		await r.fixtures.plugin.storage("outbox", "o1", {
			kind: "confirm",
			to: "p1@example.com",
			payload: {},
			attempts: 1,
			nextAttemptAt: ago(500),
			status: "sent",
		});

		let ticks = 0;
		for (; ticks < 40; ticks++) {
			const res = await budget.invokeHook("cron", { name: "retention", scheduledAt: new Date().toISOString() });
			expectWithinBudget(res, { calls: 8 });
			const state = (await r.inspect.kv.get("cron:retention")) as { phase?: string } | null;
			if (state && !state.phase) break;
		}
		expect(ticks).toBeLessThan(40);
		for (let n = 1; n <= 12; n++) {
			expect(await r.inspect.storage.get("bookings", `b${n}`), `b${n}`).toMatchObject({
				email: "",
				buyer: { name: "", email: "" },
				ipHash: null,
				status: "confirmed",
			});
		}
		// Not due: the event is unknown, and the booking is two days old (only its ipHash waits an hour).
		expect(await r.inspect.storage.get("bookings", "recent")).toMatchObject({ email: "p99@example.com" });
		expect(await r.inspect.storage.get("attendees", "b1-1")).toMatchObject({ name: "", email: "", code: "C1" });
		expect(await r.inspect.storage.get("event_configs", "ev_old")).toMatchObject({ reserved: 3, sold: 3 });
		expect(await r.inspect.storage.get("outbox", "o1")).toBeFalsy();
	});
});
