import { generateToken, hashToken } from "@semics-tech/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { holdTaskName } from "../../src/domain/holds";
import {
	CONTINUE_MAX_CALLS,
	type ContinueDeps,
	type ContinueStorage,
	continueCheckout,
} from "../../src/routes/checkout-continue";
import { FakeCron, makeStore, meter } from "../domain/fake-storage";

// public/checkout/continue with injected time and storage (EV-FR-05, EV-FR-07, R22): hold expiry,
// races with an expirer or a second continue, crash recovery, and the paid step seam for Pro.

const MIN = 60_000;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * MIN).toISOString();
const ID = "bk_0123456789abcdef0123456789abcdef";
const REF = "ABCDEFGHJK";

beforeEach(() => {
	meter.calls = 0;
});

type Doc = Record<string, unknown>;

async function world({
	status = "held",
	priceMinor = 0,
	types = ["tt_a"],
	occurrence = false,
}: {
	status?: string;
	priceMinor?: number;
	types?: string[];
	occurrence?: boolean;
} = {}) {
	const storage = makeStore();
	const token = generateToken();
	const counted = (capacity: number) => ({ capacity, reserved: types.length, sold: 0 });
	storage.event_configs.set("ev1", { status: "on_sale", ...counted(100) });
	for (const t of types) storage.ticket_types.set(t, { eventId: "ev1", ...counted(100), reserved: 1 });
	if (occurrence) storage.occurrences.set("oc1", { eventId: "ev1", ...counted(100) });
	const total = priceMinor * types.length;
	storage.bookings.set(ID, {
		ref: REF,
		eventId: "ev1",
		...(occurrence ? { occurrenceId: "oc1" } : {}),
		status,
		holdExpiresAt: at(15),
		holdCeilingAt: at(60),
		releaseClaimedAt: null,
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		email: "ada@example.com",
		lines: types.map((ticketTypeId) => ({ ticketTypeId, qty: 1, unitPriceMinor: priceMinor })),
		totals: { subtotalMinor: total, discountMinor: 0, totalMinor: total, currency: "GBP" },
		answers: {},
		accessTokenHash: await hashToken(token),
		createdAt: at(0),
	});
	const cron = new FakeCron();
	const deps = (now: number, extra: Partial<ContinueDeps> = {}): ContinueDeps => ({
		storage: storage as unknown as ContinueStorage,
		settings: {
			list: async () => {
				meter.calls++;
				return [];
			},
		},
		cron,
		now,
		...extra,
	});
	const booking = () => storage.bookings.docs.get(ID) as Doc;
	return { storage, cron, token, deps, booking, input: { bookingRef: REF, accessToken: token } };
}

const run = async (deps: ContinueDeps, input: unknown) => {
	meter.calls = 0;
	const body = (await continueCheckout(deps, input)) as Doc & { error?: { code: string } };
	const calls = meter.calls;
	expect(calls).toBeLessThanOrEqual(CONTINUE_MAX_CALLS);
	return { body, calls };
};

describe("checkout/continue hold expiry and races (EV-FR-05)", () => {
	it("EV-FR-05 an expired hold returns HOLD_EXPIRED and writes nothing", async () => {
		const w = await world();
		const before = structuredClone(w.booking());
		const { body, calls } = await run(w.deps(T0 + 15 * MIN), w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "HOLD_EXPIRED" } });
		expect(calls).toBe(1);
		expect(w.booking()).toEqual(before);
		expect(w.storage.attendees.docs.size + w.storage.outbox.docs.size).toBe(0);
	});

	it("EV-FR-05 a hold claimed by an expirer returns HOLD_EXPIRED", async () => {
		const w = await world();
		w.booking().releaseClaimedAt = at(1);
		const { body } = await run(w.deps(T0 + 2 * MIN), w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "HOLD_EXPIRED" } });
	});

	it("EV-FR-05 an expired or cancelled booking returns HOLD_EXPIRED", async () => {
		for (const status of ["expired", "cancelled"]) {
			const w = await world({ status });
			const { body } = await run(w.deps(T0), w.input);
			expect(body).toMatchObject({ ok: false, error: { code: "HOLD_EXPIRED" } });
		}
	});

	it("EV-FR-05 a draft (reserve still running) is not confirmed", async () => {
		const w = await world({ status: "draft" });
		const { body } = await run(w.deps(T0), w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
		expect(w.booking().status).toBe("draft");
	});

	it("EV-FR-05 an expirer claiming the hold mid-confirm wins: HOLD_EXPIRED, no attendees, no sale", async () => {
		const w = await world();
		w.storage.bookings.beforeUpdate = (id) => {
			const doc = w.storage.bookings.docs.get(id) as Doc;
			doc.releaseClaimedAt = at(1);
		};
		const { body } = await run(w.deps(T0 + MIN), w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "HOLD_EXPIRED" } });
		expect(w.booking().status).toBe("held");
		expect(w.storage.attendees.docs.size + w.storage.outbox.docs.size).toBe(0);
		expect((w.storage.ticket_types.docs.get("tt_a") as Doc).sold).toBe(0);
	});

	it("EV-FR-07 a second continue racing the first answers done without counting the sale twice", async () => {
		const w = await world();
		w.storage.bookings.beforeUpdate = (id) => {
			w.storage.bookings.beforeUpdate = null;
			const doc = w.storage.bookings.docs.get(id) as Doc;
			doc.status = "confirmed";
			w.storage.outbox.set(`confirm-${ID}`, { kind: "booking_confirmed" });
		};
		const { body } = await run(w.deps(T0 + MIN), w.input);
		expect(body).toMatchObject({ ok: true, status: "confirmed", next: { type: "done", bookingRef: REF } });
		expect((w.storage.ticket_types.docs.get("tt_a") as Doc).sold).toBe(0);
		expect(w.storage.attendees.docs.size).toBe(0);
	});
});

describe("checkout/continue confirm (EV-FR-07)", () => {
	it("EV-FR-07 the worst case reservation (five counters) confirms within 10 calls", async () => {
		const w = await world({ types: ["tt_a", "tt_b", "tt_c"], occurrence: true });
		const { body, calls } = await run(w.deps(T0 + MIN), w.input);
		expect(body).toMatchObject({ ok: true, status: "confirmed" });
		expect(calls).toBeLessThanOrEqual(CONTINUE_MAX_CALLS);
		for (const t of ["tt_a", "tt_b", "tt_c"]) expect((w.storage.ticket_types.docs.get(t) as Doc).sold).toBe(1);
		expect((w.storage.occurrences.docs.get("oc1") as Doc).sold).toBe(3);
		expect((w.storage.event_configs.docs.get("ev1") as Doc).sold).toBe(3);
		expect(w.booking()).toMatchObject({ status: "confirmed", confirmedAt: at(1), releaseClaimedAt: null });
		expect(w.cron.tasks.size).toBe(0);
	});

	it("EV-FR-07 a confirm that crashed before its side effects is finished by the replay, without re-counting", async () => {
		const w = await world();
		w.storage.attendees.failOn = (method) => method === "putMany";
		await expect(continueCheckout(w.deps(T0 + MIN), w.input)).rejects.toThrow();
		expect(w.booking().status).toBe("confirmed");
		expect((w.storage.ticket_types.docs.get("tt_a") as Doc).sold).toBe(1);

		w.storage.attendees.failOn = null;
		const { body } = await run(w.deps(T0 + 2 * MIN), w.input);
		expect(body).toMatchObject({ ok: true, status: "confirmed", next: { type: "done" } });
		expect(w.storage.attendees.docs.size).toBe(1);
		expect([...w.storage.outbox.docs.values()]).toMatchObject([
			{ kind: "booking_confirmed", to: "ada@example.com", payload: { bookingId: ID, bookingRef: REF } },
		]);
		expect((w.storage.ticket_types.docs.get("tt_a") as Doc).sold).toBe(1);
	});
});

describe("checkout/continue paid step seam (EV-FR-05, Pro)", () => {
	const payment = (urls: string[]) => ({
		start: async ({ holdExpiresAt }: { holdExpiresAt: string }) => {
			urls.push(holdExpiresAt);
			return { url: "https://checkout.example/session" };
		},
	});

	it("EV-FR-05 extends the hold, moves to awaiting_payment, writes pending attendees and re-arms hold-<ref>", async () => {
		const w = await world({ priceMinor: 1500 });
		const seen: string[] = [];
		const { body } = await run(w.deps(T0 + 10 * MIN, { payment: payment(seen) }), w.input);
		const extended = at(10 + 35);
		expect(body).toEqual({
			ok: true,
			bookingRef: REF,
			status: "awaiting_payment",
			holdExpiresAt: extended,
			next: { type: "pay", url: "https://checkout.example/session" },
		});
		expect(w.booking()).toMatchObject({ status: "awaiting_payment", holdExpiresAt: extended });
		expect([...w.storage.attendees.docs.values()]).toMatchObject([{ status: "pending" }]);
		expect(w.cron.tasks.get(holdTaskName(REF))).toEqual({ schedule: extended, data: { bookingId: ID } });
		expect(seen).toEqual([extended]);
		expect(w.storage.outbox.docs.size).toBe(0);
	});

	it("EV-FR-05 a later step extends to the 60-minute ceiling, never past it", async () => {
		const w = await world({ priceMinor: 1500 });
		await run(w.deps(T0 + 10 * MIN, { payment: payment([]) }), w.input);
		const { body } = await run(w.deps(T0 + 40 * MIN, { payment: payment([]) }), w.input);
		expect(body).toMatchObject({ status: "awaiting_payment", holdExpiresAt: at(60) });
		expect(w.cron.tasks.get(holdTaskName(REF))?.schedule).toBe(at(60));
	});

	it("EV-FR-05 without a payment provider (Free) a paid booking is refused unchanged", async () => {
		const w = await world({ priceMinor: 1500 });
		const before = structuredClone(w.booking());
		const { body } = await run(w.deps(T0 + MIN), w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "PAYMENT_FAILED" } });
		expect(w.booking()).toEqual(before);
		expect(w.cron.tasks.size).toBe(0);
	});
});
