import { generateToken, hashToken } from "@semics-tech/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { expireBookings, planExpiries } from "../../src/domain/holds";
import { drainEventsOutbox } from "../../src/emails/outbox";
import { type ApprovalDeps, approveBooking, declineBooking } from "../../src/routes/approval";
import { BOOKING_MAX_CALLS, type BookingRouteStorage, cancelBooking, type RefundStep } from "../../src/routes/booking";
import { CONTINUE_MAX_CALLS, type ContinueStorage, continueCheckout } from "../../src/routes/checkout-continue";
import { makeStore, meter } from "../domain/fake-storage";

// Booking approval (T131, R96) with injected time and storage: continue hands a booking that needs
// approval to `awaiting_approval` (places stay reserved), the admin approves or declines it, the
// sweeper expires it at the deadline, the buyer may withdraw it, and the outbox tells everyone.

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
	status = "held",
	paid = false,
	settings = [{ key: "adminNotifyEmails", value: "boss@example.com" }] as Array<{ key: string; value: unknown }>,
}: {
	status?: string;
	paid?: boolean;
	settings?: Array<{ key: string; value: unknown }>;
} = {}) {
	const storage = makeStore();
	const token = generateToken();
	const counted = { capacity: 100, reserved: 2, sold: 0 };
	storage.event_configs.set("ev1", {
		status: "on_sale",
		...counted,
		info: { title: "Pottery class", startsAt: at(72), endsAt: null, timezone: "UTC", venue: null },
	});
	storage.ticket_types.set("tt_a", { eventId: "ev1", ...counted });
	const awaiting = status === "awaiting_approval";
	storage.bookings.set(ID, {
		ref: REF,
		eventId: "ev1",
		status,
		holdExpiresAt: awaiting ? at(48) : at(0.25),
		holdCeilingAt: at(1),
		releaseClaimedAt: null,
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		email: "ada@example.com",
		lines: [{ ticketTypeId: "tt_a", qty: 2, unitPriceMinor: 0 }],
		totals: { subtotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: "GBP" },
		answers: {},
		approval: { until: at(48) },
		accessTokenHash: await hashToken(token),
		createdAt: at(0),
		...(paid ? { payment: { provider: "stripe", ref: "cs_1" } } : {}),
	});
	const settingsStore = {
		list: async () => {
			meter.calls++;
			return settings;
		},
	};
	const deps = (now: number, extra: Partial<ApprovalDeps> = {}): ApprovalDeps => ({
		storage: storage as unknown as ApprovalDeps["storage"],
		settings: settingsStore,
		now,
		...extra,
	});
	const continueDeps = (now: number) => ({
		storage: storage as unknown as ContinueStorage,
		settings: settingsStore,
		now,
	});
	const bookingDeps = (now: number) => ({
		storage: storage as unknown as BookingRouteStorage,
		settings: settingsStore,
		now,
	});
	const booking = () => storage.bookings.docs.get(ID) as Doc;
	const counter = (c: "ticket_types" | "event_configs", id: string) =>
		storage[c].docs.get(id) as { reserved: number; sold: number };
	return {
		storage,
		deps,
		continueDeps,
		bookingDeps,
		booking,
		counter,
		input: { bookingRef: REF, accessToken: token },
	};
}

const metered = async <T>(fn: () => Promise<T>, max = BOOKING_MAX_CALLS) => {
	meter.calls = 0;
	const body = (await fn()) as Doc & { error?: { code: string } };
	const calls = meter.calls;
	expect(calls).toBeLessThanOrEqual(max);
	return { body, calls };
};

describe("T131 continue hands a booking that needs approval to awaiting_approval", () => {
	it("T131 the places stay reserved (not sold), attendees are written, buyer and admin are told", async () => {
		const w = await world();
		const { body, calls } = await metered(() => continueCheckout(w.continueDeps(T0), w.input), CONTINUE_MAX_CALLS);
		expect(body).toMatchObject({
			ok: true,
			bookingRef: REF,
			status: "awaiting_approval",
			next: { type: "approval", bookingRef: REF },
		});
		expect(calls).toBeLessThanOrEqual(6);
		expect(w.booking()).toMatchObject({ status: "awaiting_approval", holdExpiresAt: at(48), releaseClaimedAt: null });
		expect(w.counter("ticket_types", "tt_a")).toMatchObject({ reserved: 2, sold: 0 });
		expect(w.counter("event_configs", "ev1")).toMatchObject({ reserved: 2, sold: 0 });
		expect(w.storage.attendees.docs.size).toBe(2);
		expect([...w.storage.outbox.docs.keys()].sort()).toEqual([`admin-${ID}-0`, `lapse-${ID}`, `request-${ID}`].sort());
		expect(w.storage.outbox.docs.has(`confirm-${ID}`)).toBe(false);
	});

	it("T131 a replay of continue writes nothing once the request is queued", async () => {
		const w = await world();
		await continueCheckout(w.continueDeps(T0), w.input);
		const before = structuredClone([...w.storage.outbox.docs]);
		const { body, calls } = await metered(() => continueCheckout(w.continueDeps(T0 + HOUR), w.input));
		expect(body).toMatchObject({ ok: true, status: "awaiting_approval", next: { type: "approval" } });
		expect(calls).toBe(2);
		expect([...w.storage.outbox.docs]).toEqual(before);
	});
});

describe("T131 approve", () => {
	it("T131 confirms, counts the sale and queues the confirmation (with its ICS link) within budget", async () => {
		const w = await world({ status: "awaiting_approval" });
		const { body, calls } = await metered(() => approveBooking(w.deps(T0 + HOUR), ID));
		expect(body).toMatchObject({ ok: true, bookingRef: REF, status: "confirmed" });
		expect(calls).toBeLessThanOrEqual(5);
		expect(w.booking()).toMatchObject({ status: "confirmed", confirmedAt: at(1) });
		expect(w.counter("ticket_types", "tt_a")).toMatchObject({ reserved: 2, sold: 2 });
		expect(w.storage.outbox.docs.get(`confirm-${ID}`)).toMatchObject({ kind: "booking_confirmed" });
	});

	it("T131 a double click approves once: the second answers ok and counts nothing", async () => {
		const w = await world({ status: "awaiting_approval" });
		await approveBooking(w.deps(T0 + HOUR), ID);
		const { body } = await metered(() => approveBooking(w.deps(T0 + HOUR), ID));
		expect(body).toMatchObject({ ok: true, status: "confirmed" });
		expect(w.counter("ticket_types", "tt_a")).toMatchObject({ sold: 2 });
	});

	it("T131 an approval after the deadline is refused and changes nothing", async () => {
		const w = await world({ status: "awaiting_approval" });
		const before = structuredClone(w.booking());
		const { body } = await metered(() => approveBooking(w.deps(T0 + 48 * HOUR), ID));
		expect(body).toMatchObject({ ok: false, error: { code: "HOLD_EXPIRED" } });
		expect(w.booking()).toEqual(before);
	});

	it("T131 an approval racing the expirer loses once the sweeper has claimed it", async () => {
		const w = await world({ status: "awaiting_approval" });
		w.booking().releaseClaimedAt = at(47.9);
		const { body } = await metered(() => approveBooking(w.deps(T0 + 47.95 * HOUR), ID));
		expect(body).toMatchObject({ ok: false, error: { code: "HOLD_EXPIRED" } });
		expect(w.counter("ticket_types", "tt_a")).toMatchObject({ sold: 0 });
	});

	it("T131 approving a booking that is not waiting (declined, unknown) is refused", async () => {
		const w = await world({ status: "declined" });
		expect((await approveBooking(w.deps(T0), ID)) as Doc).toMatchObject({ ok: false });
		expect((await approveBooking(w.deps(T0), "bk_missing")) as Doc).toMatchObject({
			ok: false,
			error: { code: "NOT_FOUND" },
		});
	});
});

describe("T131 decline", () => {
	it("T131 releases the places, records the reason and tells the buyer", async () => {
		const w = await world({ status: "awaiting_approval" });
		const { body, calls } = await metered(() => declineBooking(w.deps(T0 + HOUR), ID, "  Fully booked by a group  "));
		expect(body).toMatchObject({ ok: true, bookingRef: REF, status: "declined" });
		expect(calls).toBeLessThanOrEqual(7);
		expect(w.booking()).toMatchObject({ status: "declined", declineReason: "Fully booked by a group" });
		expect(w.counter("ticket_types", "tt_a")).toMatchObject({ reserved: 0, sold: 0 });
		expect(w.counter("event_configs", "ev1")).toMatchObject({ reserved: 0 });
		expect(w.storage.outbox.docs.get(`decline-${ID}`)).toMatchObject({
			kind: "booking_declined",
			to: "ada@example.com",
			payload: { bookingId: ID, bookingRef: REF },
		});
	});

	it("T131 a second decline answers ok and releases nothing twice", async () => {
		const w = await world({ status: "awaiting_approval" });
		await declineBooking(w.deps(T0), ID, "");
		const { body } = await metered(() => declineBooking(w.deps(T0), ID, ""));
		expect(body).toMatchObject({ ok: true, status: "declined" });
		expect(w.counter("ticket_types", "tt_a")).toMatchObject({ reserved: 0 });
	});

	it("T131 a confirmed (approved) booking cannot be declined", async () => {
		const w = await world({ status: "awaiting_approval" });
		await approveBooking(w.deps(T0), ID);
		const { body } = await metered(() => declineBooking(w.deps(T0), ID, ""));
		expect(body).toMatchObject({ ok: false, error: { code: "CANCEL_NOT_ALLOWED" } });
		expect(w.booking().status).toBe("confirmed");
	});

	it("T131 a paid request is declined only with its refund (Pro); Free refuses it untouched", async () => {
		const w = await world({ status: "awaiting_approval", paid: true });
		const { body } = await metered(() => declineBooking(w.deps(T0), ID, ""));
		expect(body).toMatchObject({ ok: false, error: { code: "CANCEL_NOT_ALLOWED" } });
		expect(w.booking().status).toBe("awaiting_approval");
		const seen: string[] = [];
		const refund: RefundStep = {
			calls: () => 1,
			run: async (b) => {
				seen.push(b.status);
				return { ok: true, mail: { kind: "booking_refunded", payload: { refundedMinor: 500 } } };
			},
		};
		const paid = await metered(() => declineBooking(w.deps(T0, { refund }), ID, "Sorry"));
		expect(paid.body).toMatchObject({ ok: true, status: "declined" });
		expect(seen).toEqual(["awaiting_approval"]);
		// The buyer is told it was declined (and refunded), not that they cancelled.
		expect(w.storage.outbox.docs.get(`decline-${ID}`)).toMatchObject({
			kind: "booking_declined",
			payload: { refundedMinor: 500 },
		});
	});
});

describe("T131 the buyer, the sweeper and the deadline", () => {
	it("T131 the buyer may cancel while awaiting approval: places released, nothing sold", async () => {
		const w = await world({ status: "awaiting_approval" });
		const { body } = await metered(() => cancelBooking(w.bookingDeps(T0 + HOUR), w.input));
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		expect(w.counter("ticket_types", "tt_a")).toMatchObject({ reserved: 0, sold: 0 });
		expect((await approveBooking(w.deps(T0 + HOUR), ID)) as Doc).toMatchObject({ ok: false });
	});

	it("T131 the sweep expires a request at its deadline and releases its places like a lapsed hold", async () => {
		const w = await world({ status: "awaiting_approval" });
		const items = [{ id: ID, data: w.booking() }];
		expect(planExpiries(items, T0 + 47 * HOUR, 10).planned).toHaveLength(0);
		const { planned } = planExpiries(items, T0 + 48 * HOUR, 10);
		const out = await expireBookings(w.storage as never, planned, T0 + 48 * HOUR);
		expect(out).toMatchObject([{ id: ID, outcome: "expired" }]);
		expect(w.booking()).toMatchObject({ status: "expired" });
		expect(w.counter("ticket_types", "tt_a")).toMatchObject({ reserved: 0 });
		expect((await approveBooking(w.deps(T0 + 48 * HOUR), ID)) as Doc).toMatchObject({ ok: false });
	});
});

describe("T131 approval emails through the outbox", () => {
	const drain = async (w: Awaited<ReturnType<typeof world>>, now: number) => {
		const sent: Array<{ to: string; subject: string; text: string; html?: string }> = [];
		const result = await drainEventsOutbox({
			storage: w.storage as never,
			outbox: w.storage.outbox as never,
			settings: { list: async () => [] },
			content: { get: async () => null },
			email: { send: async (m) => void sent.push(m as (typeof sent)[number]) },
			origin: "https://site.test",
			pluginId: "r_abc",
			siteName: "Pottery Barn",
			now,
		});
		return { sent, result };
	};

	it("T131 the buyer gets 'request received', the admin a link into the admin (no token in mail)", async () => {
		const w = await world();
		await continueCheckout(w.continueDeps(T0), w.input);
		const { sent } = await drain(w, T0);
		const admin = sent.find((m) => m.to === "boss@example.com");
		const buyer = sent.find((m) => m.to === "ada@example.com");
		expect(buyer?.subject).toContain("Pottery class");
		expect(buyer?.text).toMatch(/waiting for approval/i);
		expect(admin?.text).toContain("Ada Lovelace");
		expect(admin?.text).toContain("https://site.test/_emdash/admin/plugins/r_abc/bookings");
		expect(admin?.text).toMatch(/needs your approval/i);
		for (const m of sent) expect(m.text).not.toMatch(/[?&]k=|accessToken/);
	});

	it("T131 the expiry notice waits while the request is open and is sent once it expired", async () => {
		const w = await world();
		await continueCheckout(w.continueDeps(T0), w.input);
		w.storage.outbox.docs.delete(`request-${ID}`);
		w.storage.outbox.docs.delete(`admin-${ID}-0`);
		const lapse = w.storage.outbox.docs.get(`lapse-${ID}`) as Doc;
		lapse.nextAttemptAt = at(0);
		const early = await drain(w, T0);
		expect(early.sent).toHaveLength(0);
		expect(lapse.status).toBe("pending");
		w.booking().status = "expired";
		lapse.nextAttemptAt = at(0);
		const late = await drain(w, T0 + HOUR);
		expect(late.sent.map((m) => m.subject)).toEqual([expect.stringMatching(/expired/i)]);
	});

	it("T131 the expiry notice is dropped for a request decided in time", async () => {
		const w = await world({ status: "awaiting_approval" });
		w.storage.outbox.set(`lapse-${ID}`, {
			kind: "approval_expired",
			to: "ada@example.com",
			payload: { bookingId: ID, bookingRef: REF },
			attempts: 0,
			nextAttemptAt: at(0),
			status: "pending",
		});
		w.booking().status = "confirmed";
		const { sent } = await drain(w, T0);
		expect(sent).toHaveLength(0);
		expect(w.storage.outbox.docs.get(`lapse-${ID}`)).toMatchObject({ status: "sent" });
	});

	it("T131 the decline email carries the reason, escaped in HTML", async () => {
		const w = await world({ status: "awaiting_approval" });
		await declineBooking(w.deps(T0), ID, "No <b>dogs</b>");
		const { sent } = await drain(w, T0);
		expect(sent).toHaveLength(1);
		expect(sent[0]?.subject).toMatch(/declined/i);
		expect(sent[0]?.text).toContain("No <b>dogs</b>");
		expect(sent[0]?.html).toContain("No &lt;b&gt;dogs&lt;/b&gt;");
	});
});
