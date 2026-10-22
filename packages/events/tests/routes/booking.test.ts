import { generateToken, hashToken } from "@semics-tech/shared";
import { beforeEach, describe, expect, it } from "vitest";

import {
	BOOKING_MAX_CALLS,
	BOOKING_TARGET_CALLS,
	type BookingDeps,
	type BookingRouteStorage,
	bookingStatus,
	cancelBooking,
	type RefundStep,
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
	paid = false,
}: {
	paid?: boolean;
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
		...(paid ? { payment: { provider: "stripe", ref: "cs_1" } } : {}),
	});
	for (const [i, t] of types.entries()) {
		storage.attendees.set(`${ID}-${i + 1}`, {
			bookingId: ID,
			ticketTypeId: t,
			name: "Ada Lovelace",
			code: `c${i}`,
			status: "valid",
		});
	}
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
		// R33 (T050): the token holder gets each valid attendee's check-in code for the pass.
		expect(body).toMatchObject({ attendees: [{ code: "c0" }] });
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
			expect(w.counter(c, id)).toMatchObject({ capacity: 100, reserved: 0, sold: 0 });
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
		expect(w.counter("event_configs", "ev1")).toMatchObject({ capacity: 100, reserved: 1, sold: 1 });
		expect(w.storage.outbox.docs.size).toBe(0);
	});

	it("EV-US-4 a held booking can be abandoned: reserved drops, sold was never counted", async () => {
		const w = await world({ status: "held", startsInHours: 1 });
		const { body } = await run(cancelBooking, w.deps(T0), w.input);
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		expect(w.counter("event_configs", "ev1")).toMatchObject({ capacity: 100, reserved: 0, sold: 0 });
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
		expect(w.counter("event_configs", "ev1")).toMatchObject({ capacity: 100, reserved: 1, sold: 1 });
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

	it("EV-NFR-03 a stale claim on a confirmed booking (a cancel that died) is not released twice", async () => {
		const w = await world();
		// The dead cancel claimed the booking and may already have released its seats.
		w.booking().releaseClaimedAt = at(-1);
		const { body } = await run(cancelBooking, w.deps(T0), w.input);
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		expect(w.booking().status).toBe("cancelled");
		// Releasing again could under-count (oversell); drift repair settles the counters instead.
		expect(w.counter("event_configs", "ev1")).toMatchObject({ reserved: 1, sold: 1 });
		expect(w.counter("ticket_types", "tt_a")).toMatchObject({ reserved: 1, sold: 1 });
		expect(w.counter("occurrences", "oc1")).toMatchObject({ reserved: 1, sold: 1 });
	});
});

describe("public/booking/cancel of a paid booking (EV-US-4, T075)", () => {
	const ok = (probe: () => unknown = () => null): RefundStep & { seen: unknown[] } => {
		const seen: unknown[] = [];
		return {
			seen,
			calls: () => 2,
			run: async (b, settings) => {
				seen.push({ status: b.status, claimed: probe(), key: settings.stripeSecretKey });
				meter.calls += 2;
				return { ok: true, mail: { kind: "booking_refunded", payload: { reason: "cancelled" } } };
			},
		};
	};
	const keyed = [{ key: "stripeSecretKey", value: "sk_test_1" }];

	it("T075 without a refund step a paid confirmed booking is never cancelled", async () => {
		const w = await world({ paid: true });
		const before = structuredClone(w.booking());
		const { body } = await run(cancelBooking, w.deps(T0), w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "CANCEL_NOT_ALLOWED" } });
		expect(w.booking()).toEqual(before);
		expect(w.counter("event_configs", "ev1")).toMatchObject({ reserved: 1, sold: 1 });
		expect(w.storage.outbox.docs.size).toBe(0);
	});

	it("T075 the refund step runs after the claim and before the seats are released, then the status moves", async () => {
		const w = await world({ paid: true, settings: keyed });
		const step = ok(() => w.booking().releaseClaimedAt);
		const seats: unknown[] = [];
		w.storage.event_configs.beforeUpdate = () => seats.push(step.seen.length);
		const { body, calls } = await run(cancelBooking, { ...w.deps(T0), refund: step }, w.input);
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		expect(step.seen).toEqual([{ status: "confirmed", claimed: at(0), key: "sk_test_1" }]);
		expect(seats).toEqual([1]);
		expect(w.booking()).toMatchObject({ status: "cancelled" });
		// Event and occurrence first; the type counter is left to drift repair (the step took two calls).
		expect(w.counter("event_configs", "ev1")).toMatchObject({ reserved: 0, sold: 0 });
		expect(w.counter("occurrences", "oc1")).toMatchObject({ reserved: 0, sold: 0 });
		expect(w.storage.outbox.docs.get(`cancel-${ID}`)).toMatchObject({
			kind: "booking_refunded",
			payload: { bookingId: ID, bookingRef: REF, reason: "cancelled" },
		});
		expect(calls).toBeLessThanOrEqual(BOOKING_MAX_CALLS);
	});

	it("T075 the step's calls come out of the counters' room, so the largest order stays within 10", async () => {
		const w = await world({ paid: true, settings: keyed, types: ["tt_a", "tt_b", "tt_c"] });
		const { body } = await run(cancelBooking, { ...w.deps(T0), refund: ok() }, w.input);
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		expect(w.counter("event_configs", "ev1").reserved).toBe(0);
	});

	it("T075 a refund that cannot be made refuses the cancel and clears the claim: nothing else changes", async () => {
		const w = await world({ paid: true, settings: keyed });
		const refund: RefundStep = { calls: () => 2, run: async () => ({ ok: false }) };
		const { body } = await run(cancelBooking, { ...w.deps(T0), refund }, w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "PAYMENT_FAILED" } });
		expect(w.booking()).toMatchObject({ status: "confirmed", releaseClaimedAt: null });
		expect(w.counter("event_configs", "ev1")).toMatchObject({ reserved: 1, sold: 1 });
		expect(w.storage.outbox.docs.size).toBe(0);
	});

	it("T075 outside the cutoff the step is never called", async () => {
		const w = await world({ paid: true, settings: keyed });
		const step = ok();
		const { body } = await run(cancelBooking, { ...w.deps(T0 + 30 * HOUR), refund: step }, w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "CANCEL_NOT_ALLOWED" } });
		expect(step.seen).toEqual([]);
	});

	it("T075 a free booking never touches the step", async () => {
		const w = await world({ settings: keyed });
		const step = ok();
		const { body } = await run(cancelBooking, { ...w.deps(T0), refund: step }, w.input);
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		expect(step.seen).toEqual([]);
		expect(w.storage.outbox.docs.get(`cancel-${ID}`)).toMatchObject({ kind: "booking_cancelled" });
	});
});

describe("public/booking waiver reconciliation data (SX-FR-05, T066)", () => {
	const WAIVER = { templateId: "tpl_waiver", mode: "each_attendee" };

	async function waiting(types = ["tt_a", "tt_b"]) {
		const w = await world({ status: "awaiting_signature", types, occurrence: false });
		w.booking().waiver = WAIVER;
		for (const [i] of types.entries()) (w.storage.attendees.docs.get(`${ID}-${i + 1}`) as Doc).status = "pending";
		return w;
	}

	it("SX-FR-05 a booking awaiting signatures lists the refs still unsigned, never a signed seat", async () => {
		const w = await waiting();
		(w.storage.attendees.docs.get(`${ID}-1`) as Doc).signature = { envelopeId: "env_1", status: "completed" };
		const { body, calls } = await run(bookingStatus, w.deps(T0), w.input);
		expect(body).toMatchObject({ status: "awaiting_signature", waiver: { refs: [`${REF}:2`] } });
		expect(body).not.toHaveProperty("waiver.lookups");
		expect(calls).toBeLessThanOrEqual(BOOKING_TARGET_CALLS);
	});

	it("SX-FR-05 mode buyer: one ref, the booking's", async () => {
		const w = await waiting();
		w.booking().waiver = { ...WAIVER, mode: "buyer" };
		const { body } = await run(bookingStatus, w.deps(T0), w.input);
		expect(body).toMatchObject({ waiver: { refs: [REF] } });
	});

	it("SX-FR-05 a booking without a waiver, a confirmed one and a fully signed one carry no waiver data", async () => {
		const plain = await world({ status: "awaiting_signature" });
		expect((await run(bookingStatus, plain.deps(T0), plain.input)).body).not.toHaveProperty("waiver");
		const confirmed = await world();
		confirmed.booking().waiver = WAIVER;
		expect((await run(bookingStatus, confirmed.deps(T0), confirmed.input)).body).not.toHaveProperty("waiver");
		const signed = await waiting(["tt_a"]);
		(signed.storage.attendees.docs.get(`${ID}-1`) as Doc).signature = { envelopeId: "e", status: "completed" };
		expect((await run(bookingStatus, signed.deps(T0), signed.input)).body).not.toHaveProperty("waiver");
	});

	it("SX-FR-05 the Pro lookups step mints a request per ref from the settings, within the design target", async () => {
		const w = await waiting();
		const seen: Array<{ refs: string[]; settings: Record<string, unknown> }> = [];
		const deps = {
			...w.deps(T0),
			settings: {
				list: async () => {
					meter.calls++;
					return [{ key: "esignPairing", value: "p" }];
				},
			},
			lookups: async (refs: string[], settings: Record<string, unknown>) => {
				seen.push({ refs, settings });
				return Object.fromEntries(refs.map((r) => [r, `lookup-${r}`]));
			},
		};
		const { body, calls } = await run(bookingStatus, deps, w.input);
		expect(body).toMatchObject({
			waiver: {
				refs: [`${REF}:1`, `${REF}:2`],
				lookups: { [`${REF}:1`]: `lookup-${REF}:1`, [`${REF}:2`]: `lookup-${REF}:2` },
			},
		});
		expect(seen[0]?.settings).toMatchObject({ esignPairing: "p" });
		expect(calls).toBeLessThanOrEqual(BOOKING_TARGET_CALLS);
	});

	it("SX-FR-05 at most ten refs are listed, so a large booking stays within the bridge budget", async () => {
		const w = await waiting(Array.from({ length: 12 }, (_, i) => `tt_${i}`));
		const { body } = await run(bookingStatus, w.deps(T0), w.input);
		expect((body as { waiver: { refs: string[] } }).waiver.refs).toHaveLength(10);
	});
});
