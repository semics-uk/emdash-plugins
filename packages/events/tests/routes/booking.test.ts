import { generateToken, hashToken } from "@semics-tech/shared";
import { beforeEach, describe, expect, it } from "vitest";

import {
	BOOKING_MAX_CALLS,
	BOOKING_TARGET_CALLS,
	type BookingDeps,
	type BookingRouteStorage,
	bookingStatus,
	cancelBooking,
} from "../../src/routes/booking";
import { makeStore, meter } from "../domain/fake-storage";

// public/booking and public/booking/cancel with injected time and storage (EV-US-4, R22): the
// token is checked like checkout/continue's, cancel releases seats before the status moves.

const HOUR = 3_600_000;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const at = (hours: number) => new Date(T0 + hours * HOUR).toISOString();
const ID = "bk_0123456789abcdef0123456789abcdef";
const REF = "ABCDEFGHJK";

beforeEach(() => {
	meter.calls = 0;
});

type Doc = Record<string, unknown>;

async function world({
	status = "confirmed",
	types = ["tt_a"],
	occurrence = true,
	startsInHours = 48,
	settings = [] as Array<{ key: string; value: unknown }>,
}: {
	status?: string;
	types?: string[];
	occurrence?: boolean;
	startsInHours?: number;
	settings?: Array<{ key: string; value: unknown }>;
} = {}) {
	const storage = makeStore();
	const token = generateToken();
	const sold = status === "confirmed" ? 1 : 0;
	const counted = (capacity: number, n = 1) => ({ capacity, reserved: n, sold: sold * n });
	storage.event_configs.set("ev1", {
		status: "on_sale",
		...counted(100, types.length),
		catalog: { ticketTypes: {}, occurrences: { oc1: { capacity: 100, startsAt: at(startsInHours), status: "open" } } },
	});
	for (const t of types) storage.ticket_types.set(t, { eventId: "ev1", ...counted(100) });
	if (occurrence) storage.occurrences.set("oc1", { eventId: "ev1", ...counted(100, types.length) });
	storage.bookings.set(ID, {
		ref: REF,
		eventId: "ev1",
		...(occurrence ? { occurrenceId: "oc1" } : {}),
		status,
		holdExpiresAt: at(0.25),
		holdCeilingAt: at(1),
		releaseClaimedAt: null,
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		email: "ada@example.com",
		lines: types.map((ticketTypeId) => ({ ticketTypeId, qty: 1, unitPriceMinor: 0 })),
		totals: { subtotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: "GBP" },
		answers: {},
		accessTokenHash: await hashToken(token),
		createdAt: at(-1),
	});
	types.forEach((t, i) =>
		storage.attendees.set(`${ID}-${i + 1}`, {
			bookingId: ID,
			ticketTypeId: t,
			name: "Ada Lovelace",
			code: `c${i}`,
			status: "valid",
		}),
	);
	const deps = (now: number): BookingDeps => ({
		storage: storage as unknown as BookingRouteStorage,
		settings: {
			list: async () => {
				meter.calls++;
				return settings;
			},
		},
		now,
	});
	const booking = () => storage.bookings.docs.get(ID) as Doc;
	const counter = (c: "ticket_types" | "occurrences" | "event_configs", id: string) =>
		storage[c].docs.get(id) as { reserved: number; sold: number };
	return { storage, token, deps, booking, counter, input: { bookingRef: REF, accessToken: token } };
}

async function run(fn: typeof bookingStatus, deps: BookingDeps, input: unknown) {
	meter.calls = 0;
	const body = (await fn(deps, input)) as Doc & { error?: { code: string } };
	const calls = meter.calls;
	expect(calls).toBeLessThanOrEqual(BOOKING_MAX_CALLS);
	return { body, calls };
}

describe("public/booking (EV-US-4)", () => {
	it("EV-US-4 a wrong token answers exactly like an unknown ref, with the same bridge calls", async () => {
		const w = await world();
		const wrong = await run(bookingStatus, w.deps(T0), { bookingRef: REF, accessToken: generateToken() });
		const unknown = await run(bookingStatus, w.deps(T0), { bookingRef: "ZZZZZZZZZZ", accessToken: w.token });
		expect(wrong.body).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
		expect(wrong.body).toEqual(unknown.body);
		expect(wrong.calls).toBe(unknown.calls);
		const cancelWrong = await run(cancelBooking, w.deps(T0), { bookingRef: REF, accessToken: generateToken() });
		expect(cancelWrong.body).toEqual(wrong.body);
		expect(w.booking().status).toBe("confirmed");
	});

	it("EV-US-4 shows the booking, its attendees and whether it can still be cancelled", async () => {
		const w = await world();
		const { body, calls } = await run(bookingStatus, w.deps(T0), w.input);
		expect(body).toMatchObject({
			ok: true,
			bookingRef: REF,
			status: "confirmed",
			canCancel: true,
			cancelBy: at(24),
			attendees: [{ name: "Ada Lovelace", ticketTypeId: "tt_a", status: "valid" }],
		});
		expect(JSON.stringify(body)).not.toContain("accessTokenHash");
		expect(JSON.stringify(body)).not.toContain('"code":"c0"');
		expect(calls).toBeLessThanOrEqual(BOOKING_TARGET_CALLS);
	});

	it("EV-US-4 canCancel is false inside the cutoff", async () => {
		const w = await world();
		const { body } = await run(bookingStatus, w.deps(T0 + 30 * HOUR), w.input);
		expect(body).toMatchObject({ ok: true, canCancel: false });
	});

	it("EV-US-4 a malformed body is a bad request", async () => {
		const w = await world();
		const { body } = await run(bookingStatus, w.deps(T0), { bookingRef: REF });
		expect(body).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
	});
});

describe("public/booking/cancel (EV-US-4)", () => {
	it("EV-US-4 cancel inside policy releases the seats, moves the status and queues the notice", async () => {
		const w = await world();
		const { body, calls } = await run(cancelBooking, w.deps(T0), w.input);
		expect(body).toMatchObject({ ok: true, bookingRef: REF, status: "cancelled" });
		expect(w.booking()).toMatchObject({ status: "cancelled", cancelledAt: at(0) });
		for (const [c, id] of [
			["ticket_types", "tt_a"],
			["occurrences", "oc1"],
			["event_configs", "ev1"],
		] as const)
			expect(w.counter(c, id)).toEqual({ capacity: 100, reserved: 0, sold: 0 });
		expect(w.storage.outbox.docs.get(`cancel-${ID}`)).toMatchObject({
			kind: "booking_cancelled",
			to: "ada@example.com",
			status: "pending",
		});
		expect(calls).toBeLessThanOrEqual(BOOKING_TARGET_CALLS + 1);
	});

	it("EV-US-4 the cutoff comes from the cancelCutoffHours setting", async () => {
		const w = await world({ settings: [{ key: "cancelCutoffHours", value: 2 }] });
		const { body } = await run(cancelBooking, w.deps(T0 + 40 * HOUR), w.input);
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
	});

	it("EV-US-4 cancel outside policy is refused and writes nothing", async () => {
		const w = await world();
		const before = structuredClone(w.booking());
		const { body } = await run(cancelBooking, w.deps(T0 + 30 * HOUR), w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "CANCEL_NOT_ALLOWED" } });
		expect(w.booking()).toEqual(before);
		expect(w.counter("event_configs", "ev1")).toEqual({ capacity: 100, reserved: 1, sold: 1 });
		expect(w.storage.outbox.docs.size).toBe(0);
	});

	it("EV-US-4 a held booking can be abandoned: reserved drops, sold was never counted", async () => {
		const w = await world({ status: "held" });
		const { body } = await run(cancelBooking, w.deps(T0 + 30 * HOUR), w.input);
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		expect(w.counter("event_configs", "ev1")).toEqual({ capacity: 100, reserved: 0, sold: 0 });
	});

	it("EV-US-4 seats are released before the status moves", async () => {
		const w = await world();
		const seen: string[] = [];
		w.storage.event_configs.beforeUpdate = () => seen.push(String(w.booking().status));
		await run(cancelBooking, w.deps(T0), w.input);
		expect(seen).toEqual(["confirmed"]);
	});

	it("EV-US-4 a replay of a cancelled booking answers ok and writes nothing", async () => {
		const w = await world();
		await run(cancelBooking, w.deps(T0), w.input);
		const before = structuredClone(w.booking());
		const { body, calls } = await run(cancelBooking, w.deps(T0 + HOUR), w.input);
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		expect(calls).toBe(1);
		expect(w.booking()).toEqual(before);
		expect(w.counter("event_configs", "ev1").reserved).toBe(0);
	});

	it("EV-US-4 a concurrent cancel that claims first wins: this one releases nothing", async () => {
		const w = await world();
		w.storage.bookings.beforeUpdate = (id, args) => {
			w.storage.bookings.beforeUpdate = null;
			const claim = (args as { set?: Doc }).set?.releaseClaimedAt;
			if (claim) (w.storage.bookings.docs.get(id) as Doc).releaseClaimedAt = claim;
		};
		const { body } = await run(cancelBooking, w.deps(T0), w.input);
		expect(body).toMatchObject({ ok: false });
		expect(w.counter("event_configs", "ev1")).toEqual({ capacity: 100, reserved: 1, sold: 1 });
	});

	it("EV-US-4 a hold claimed by an expirer is HOLD_EXPIRED", async () => {
		const w = await world({ status: "held" });
		w.booking().releaseClaimedAt = at(0);
		const { body } = await run(cancelBooking, w.deps(T0), w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "HOLD_EXPIRED" } });
	});

	it("EV-US-4 an expired booking cannot be cancelled", async () => {
		const w = await world({ status: "expired" });
		const { body } = await run(cancelBooking, w.deps(T0), w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "CANCEL_NOT_ALLOWED" } });
	});

	it("R22 the largest order (three ticket types and an occurrence) cancels within 10 bridge calls", async () => {
		const w = await world({ types: ["tt_a", "tt_b", "tt_c"] });
		const { body } = await run(cancelBooking, w.deps(T0), w.input);
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		// The event and occurrence counters come first; the sweeper's drift repair finishes the rest.
		expect(w.counter("event_configs", "ev1").reserved).toBe(0);
		expect(w.counter("occurrences", "oc1").reserved).toBe(0);
	});

	it("EV-US-4 a failing release does not leave the booking stuck: it still cancels", async () => {
		const w = await world();
		w.storage.ticket_types.failOn = () => true;
		const { body } = await run(cancelBooking, w.deps(T0), w.input);
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		expect(w.booking().status).toBe("cancelled");
	});
});
