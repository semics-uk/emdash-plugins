import { generateToken, hashToken } from "@semics-tech/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("checkout/continue unknown ref (T100, T057 review F10)", () => {
	it("hashes the token for an unknown ref exactly as for a wrong token, and both are NOT_FOUND", async () => {
		const w = await world();
		const digest = vi.spyOn(crypto.subtle, "digest");
		try {
			const wrong = await run(w.deps(T0), { bookingRef: REF, accessToken: generateToken() });
			const wrongDigests = digest.mock.calls.length;
			digest.mockClear();
			const unknown = await run(w.deps(T0), { bookingRef: "ZZZZZZZZZZ", accessToken: generateToken() });
			expect(wrong.body).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
			expect(unknown.body).toEqual(wrong.body);
			expect(unknown.calls).toBe(wrong.calls);
			expect(wrongDigests).toBe(1);
			expect(digest.mock.calls.length).toBe(wrongDigests);
		} finally {
			digest.mockRestore();
		}
	});
});

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
	type Prepared = { bookingId: string; booking: Doc; settings: Record<string, unknown> };
	/** A step that records what it was given; `refuse`/`fail` make `prepare`/`start` refuse. */
	const payment = (
		holds: string[],
		{ seen, refuse, fail }: { seen?: Prepared[]; refuse?: string; fail?: string } = {},
	): NonNullable<ContinueDeps["payment"]> => ({
		prepare: async (args) => {
			seen?.push(structuredClone(args) as unknown as Prepared);
			if (refuse) return { ok: false, error: { code: refuse } } as never;
			return {
				ok: true,
				value: {
					start: async (holdExpiresAt: string) => {
						holds.push(holdExpiresAt);
						if (fail) return { ok: false, error: { code: fail } } as never;
						return { ok: true, value: { url: "https://checkout.example/session" } };
					},
				},
			};
		},
	});

	it("EV-FR-05 prepare sees the booking as read and the settings checkout loaded, before any write", async () => {
		const w = await world({ priceMinor: 1500 });
		const seen: Prepared[] = [];
		const settings = {
			list: async () => {
				meter.calls++;
				return [{ key: "stripeSecretKey", value: "sk_test_x" }];
			},
		};
		await run(w.deps(T0 + MIN, { payment: payment([], { seen }), settings }), w.input);
		expect(seen).toMatchObject([
			{ bookingId: ID, booking: { status: "held" }, settings: { stripeSecretKey: "sk_test_x" } },
		]);
		// A continue of a booking already awaiting payment is in-flight work: the step sees that status.
		await run(w.deps(T0 + 2 * MIN, { payment: payment([], { seen }), settings }), w.input);
		expect(seen[1]?.booking.status).toBe("awaiting_payment");
	});

	it("EV-FR-05 a refusal from prepare (no licence, no provider key) writes nothing", async () => {
		const w = await world({ priceMinor: 1500 });
		const before = structuredClone(w.booking());
		const holds: string[] = [];
		const { body } = await run(w.deps(T0 + MIN, { payment: payment(holds, { refuse: "LICENCE_INVALID" }) }), w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "LICENCE_INVALID" } });
		expect(w.booking()).toEqual(before);
		expect(w.storage.attendees.docs.size + w.cron.tasks.size + holds.length).toBe(0);
	});

	it("EV-FR-05 a provider failure is PAYMENT_FAILED; the booking waits for a retry under its hold", async () => {
		const w = await world({ priceMinor: 1500 });
		const { body } = await run(w.deps(T0 + MIN, { payment: payment([], { fail: "PAYMENT_FAILED" }) }), w.input);
		expect(body).toMatchObject({ ok: false, error: { code: "PAYMENT_FAILED" } });
		expect(w.booking()).toMatchObject({ status: "awaiting_payment", holdExpiresAt: at(1 + 35) });
		const retry = await run(w.deps(T0 + 2 * MIN, { payment: payment([]) }), w.input);
		expect(retry.body).toMatchObject({ ok: true, status: "awaiting_payment", next: { type: "pay" } });
	});

	it("R22 the paid step leaves the provider three of the eight target calls", async () => {
		const w = await world({ priceMinor: 1500, types: ["tt_a", "tt_b"], occurrence: true });
		const { calls } = await run(w.deps(T0 + MIN, { payment: payment([]) }), w.input);
		expect(calls).toBe(5);
	});

	it("EV-FR-12 a paid waiver booking awaiting payment keeps its signed attendees (+1 call)", async () => {
		const w = await world({ priceMinor: 1500, types: ["tt_a", "tt_b"], status: "awaiting_payment" });
		w.booking().waiver = { templateId: "tpl_waiver", mode: "each_attendee" };
		const signed = (seat: number, name: string) => ({
			bookingId: ID,
			ticketTypeId: seat === 1 ? "tt_a" : "tt_b",
			name,
			status: "valid",
			code: `code-${seat}`,
			signature: { envelopeId: `env_${seat}`, status: "completed", docSha256: "a".repeat(64) },
		});
		w.storage.attendees.set(`${ID}-1`, signed(1, "Ada Lovelace"));
		w.storage.attendees.set(`${ID}-2`, signed(2, "Charles Babbage"));
		const before = structuredClone([...w.storage.attendees.docs.entries()]);
		// Continue again without attendees: the signed seats must not become the buyer's name.
		const { body, calls } = await run(w.deps(T0 + MIN, { payment: payment([]) }), w.input);
		expect(body).toMatchObject({ ok: true, status: "awaiting_payment", next: { type: "pay" } });
		expect([...w.storage.attendees.docs.entries()]).toEqual(before);
		expect(calls).toBe(6);
	});

	it("EV-FR-12 T078 'Pay now' on a paid waiver booking keeps an unsigned emailed adult as stored, never the buyer's name", async () => {
		const w = await world({ priceMinor: 1500, types: ["tt_a", "tt_b"], status: "awaiting_payment" });
		w.booking().waiver = { templateId: "tpl_waiver", mode: "each_attendee" };
		w.storage.attendees.set(`${ID}-1`, {
			bookingId: ID,
			ticketTypeId: "tt_a",
			name: "Ada Lovelace",
			status: "valid",
			code: "code-1",
			signature: { envelopeId: "env_1", status: "completed", docSha256: "a".repeat(64) },
		});
		// Charles signs by email: no receipt yet, so his seat has no signature and stays pending.
		w.storage.attendees.set(`${ID}-2`, {
			bookingId: ID,
			ticketTypeId: "tt_b",
			name: "Charles Babbage",
			email: "charles@example.com",
			status: "pending",
			code: "code-2",
		});
		const before = structuredClone([...w.storage.attendees.docs.entries()]);
		for (let i = 0; i < 2; i++) {
			const { body, calls } = await run(w.deps(T0 + MIN + i, { payment: payment([]) }), w.input);
			expect(body).toMatchObject({ ok: true, status: "awaiting_payment", next: { type: "pay" } });
			expect(calls).toBeLessThanOrEqual(6);
		}
		expect([...w.storage.attendees.docs.entries()]).toEqual(before);
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

describe("checkout/continue signature step seam (EV-FR-12, R5; Pro fills it)", () => {
	const WAIVER = { templateId: "tpl_waiver", mode: "each_attendee" };
	type Prepared = { bookingId: string; settings: Record<string, unknown>; attendees: Array<{ id: string; data: Doc }> };
	type Seen = { prepared?: Prepared; holds: string[] };

	/** A step that records what it was given and mints one fake intent per attendee. */
	function step(seen: Seen, refuse?: unknown): NonNullable<ContinueDeps["signature"]> {
		return {
			prepare: async (args) => {
				seen.prepared = args as unknown as Prepared;
				if (refuse) return { ok: false, error: refuse } as never;
				return {
					ok: true,
					value: {
						issue: async (holdExpiresAt: string) => {
							seen.holds.push(holdExpiresAt);
							return args.attendees.map((a) => ({ ref: `${REF}:${a.id}`, delivery: "inline", token: "t" }));
						},
					},
				};
			},
		};
	}

	const withMinor = [
		{ ticketTypeId: "tt_a", name: "Ada Lovelace" },
		{ ticketTypeId: "tt_b", name: "Ada's son", minor: true },
	];

	it("EV-FR-12 a waiver booking moves to awaiting_signature, writes pending attendees and returns the intents", async () => {
		const w = await world({ types: ["tt_a", "tt_b"] });
		w.booking().waiver = WAIVER;
		const seen: Seen = { holds: [] };
		const { body, calls } = await run(w.deps(T0 + 5 * MIN, { signature: step(seen) }), {
			...w.input,
			attendees: withMinor,
		});
		const extended = at(5 + 15);
		expect(body).toEqual({
			ok: true,
			bookingRef: REF,
			status: "awaiting_signature",
			holdExpiresAt: extended,
			next: {
				type: "sign",
				intents: [
					{ ref: `${REF}:${ID}-1`, delivery: "inline", token: "t" },
					{ ref: `${REF}:${ID}-2`, delivery: "inline", token: "t" },
				],
			},
		});
		// One settings read serves both the hold settings and the step (licence, pairing).
		expect(calls).toBeLessThanOrEqual(8);
		expect(seen.holds).toEqual([extended]);
		expect(seen.prepared?.bookingId).toBe(ID);
		expect(w.booking()).toMatchObject({ status: "awaiting_signature", holdExpiresAt: extended });
		const docs = [...w.storage.attendees.docs.values()] as Doc[];
		expect(docs).toMatchObject([
			{ status: "pending", name: "Ada Lovelace" },
			{ status: "pending", name: "Ada's son", minor: true },
		]);
		expect(docs[0]).not.toHaveProperty("minor");
		expect(w.cron.tasks.get(holdTaskName(REF))?.schedule).toBe(extended);
		expect(w.storage.outbox.docs.size).toBe(0);
	});

	it("EV-FR-12 continuing a booking that awaits signatures keeps the attendees whose receipts are in (T064)", async () => {
		const w = await world({ types: ["tt_a", "tt_b"] });
		w.booking().waiver = WAIVER;
		await run(w.deps(T0 + MIN, { signature: step({ holds: [] }) }), { ...w.input, attendees: withMinor });
		const signed = {
			...(w.storage.attendees.docs.get(`${ID}-1`) as Doc),
			status: "valid",
			signature: { envelopeId: "env_1", status: "completed", docSha256: "a".repeat(64) },
		};
		w.storage.attendees.set(`${ID}-1`, signed);
		const seen: Seen = { holds: [] };
		const { body, calls } = await run(w.deps(T0 + 2 * MIN, { signature: step(seen) }), {
			...w.input,
			attendees: withMinor,
		});
		expect(body).toMatchObject({ ok: true, status: "awaiting_signature", next: { type: "sign" } });
		expect(calls).toBeLessThanOrEqual(8);
		// The step sees the stored signature (so Pro re-issues intents only for seats still unsigned).
		expect(seen.prepared?.attendees[0]?.data).toMatchObject({ status: "valid", signature: { status: "completed" } });
		expect(w.storage.attendees.docs.get(`${ID}-1`)).toEqual(signed);
		expect(w.storage.attendees.docs.get(`${ID}-2`)).toMatchObject({ status: "pending", minor: true });
	});

	it("SX-FR-02 a retry without attendees re-issues for the stored attendees instead of replanning them in the buyer's name (T066)", async () => {
		const w = await world({ types: ["tt_a", "tt_b"] });
		w.booking().waiver = WAIVER;
		await run(w.deps(T0 + MIN, { signature: step({ holds: [] }) }), { ...w.input, attendees: withMinor });
		const before = structuredClone([...w.storage.attendees.docs.values()]);
		const seen: Seen = { holds: [] };
		const { body, calls } = await run(w.deps(T0 + 2 * MIN, { signature: step(seen) }), w.input);
		expect(body).toMatchObject({ ok: true, status: "awaiting_signature", next: { type: "sign" } });
		expect(calls).toBeLessThanOrEqual(8);
		expect(seen.prepared?.attendees.map((a) => a.data)).toMatchObject([
			{ name: "Ada Lovelace" },
			{ name: "Ada's son", minor: true },
		]);
		expect([...w.storage.attendees.docs.values()]).toEqual(before);
	});

	it("T067 SX-FR-05 re-issuing intents marks seats whose receipt was declined, so reconciliation looks them up again", async () => {
		const w = await world({ types: ["tt_a", "tt_b"] });
		w.booking().waiver = WAIVER;
		await run(w.deps(T0 + MIN, { signature: step({ holds: [] }) }), { ...w.input, attendees: withMinor });
		const receipt = (status: string) => ({ envelopeId: "env_1", status, docSha256: "a".repeat(64), at: 7 });
		const signed = {
			...(w.storage.attendees.docs.get(`${ID}-1`) as Doc),
			status: "valid",
			signature: receipt("completed"),
		};
		const declined = { ...(w.storage.attendees.docs.get(`${ID}-2`) as Doc), signature: receipt("declined") };
		w.storage.attendees.set(`${ID}-1`, signed);
		w.storage.attendees.set(`${ID}-2`, declined);
		const { body } = await run(w.deps(T0 + 2 * MIN, { signature: step({ holds: [] }) }), w.input);
		expect(body).toMatchObject({ ok: true, status: "awaiting_signature", next: { type: "sign" } });
		expect(w.storage.attendees.docs.get(`${ID}-1`)).toEqual(signed);
		expect(w.storage.attendees.docs.get(`${ID}-2`)).toEqual({
			...declined,
			signature: { ...receipt("declined"), reissued: true },
		});
	});

	const adults = [
		{ ticketTypeId: "tt_a", name: "Ada Lovelace" },
		{ ticketTypeId: "tt_b", name: "Charles Babbage", email: "charles@example.com" },
	];

	it("T119 F7 once awaiting signatures, continue refuses to re-describe a seat (name, email or under 18) and writes nothing", async () => {
		for (const changed of [
			[adults[0], { ...adults[1], name: "Mallory" }],
			[adults[0], { ...adults[1], email: "mallory@example.com" }],
			[adults[0], { ...adults[1], minor: true }],
			[
				{ ...adults[1], ticketTypeId: "tt_a" },
				{ ...adults[0], ticketTypeId: "tt_b" },
			],
		]) {
			const w = await world({ types: ["tt_a", "tt_b"] });
			w.booking().waiver = WAIVER;
			await run(w.deps(T0 + MIN, { signature: step({ holds: [] }) }), { ...w.input, attendees: adults });
			const before = structuredClone({ booking: w.booking(), attendees: [...w.storage.attendees.docs.entries()] });
			const seen: Seen = { holds: [] };
			const { body, calls } = await run(w.deps(T0 + 2 * MIN, { signature: step(seen) }), {
				...w.input,
				attendees: changed,
			});
			expect(body, JSON.stringify(changed)).toMatchObject({
				ok: false,
				error: { code: "BAD_REQUEST" },
				issues: [{ path: "attendees", code: "ATTENDEES_LOCKED" }],
			});
			expect(seen.prepared).toBeUndefined();
			expect({ booking: w.booking(), attendees: [...w.storage.attendees.docs.entries()] }).toEqual(before);
			expect(calls).toBeLessThanOrEqual(8);
		}
		// The same attendees again (a resubmitted form) are fine: email case and spacing do not count.
		const w = await world({ types: ["tt_a", "tt_b"] });
		w.booking().waiver = WAIVER;
		await run(w.deps(T0 + MIN, { signature: step({ holds: [] }) }), { ...w.input, attendees: adults });
		const same = [adults[0], { ...adults[1], email: " Charles@Example.com " }];
		const { body } = await run(w.deps(T0 + 2 * MIN, { signature: step({ holds: [] }) }), {
			...w.input,
			attendees: same,
		});
		expect(body).toMatchObject({ ok: true, status: "awaiting_signature" });
	});

	it("T119 F6 R44 Free continuing a booking still awaiting signatures (a Pro hold open at the downgrade) keeps its attendees and receipts", async () => {
		const w = await world({ types: ["tt_a", "tt_b"] });
		w.booking().waiver = WAIVER;
		await run(w.deps(T0 + MIN, { signature: step({ holds: [] }) }), { ...w.input, attendees: adults });
		const signed = {
			...(w.storage.attendees.docs.get(`${ID}-1`) as Doc),
			status: "valid",
			signature: { envelopeId: "env_1", status: "completed", docSha256: "a".repeat(64) },
		};
		w.storage.attendees.set(`${ID}-1`, signed);
		const before = structuredClone([...w.storage.attendees.docs.entries()]);
		// Free: no signature step. Continuing without attendees (the suite's retry) or with them confirms.
		for (const input of [w.input, { ...w.input, attendees: adults }]) {
			const { body, calls } = await run(w.deps(T0 + 2 * MIN), input);
			expect(body).toMatchObject({ ok: true, status: "confirmed" });
			expect(calls).toBeLessThanOrEqual(CONTINUE_MAX_CALLS);
			expect([...w.storage.attendees.docs.entries()]).toEqual(before);
		}
		expect(w.storage.attendees.docs.get(`${ID}-2`)).toMatchObject({ name: "Charles Babbage", status: "pending" });
	});

	it("T119 F7 a paid waiver booking awaiting payment keeps an emailed adult who has not signed yet (not the buyer's name)", async () => {
		const w = await world({ priceMinor: 1500, types: ["tt_a", "tt_b"], status: "awaiting_payment" });
		w.booking().waiver = WAIVER;
		w.storage.attendees.set(`${ID}-1`, {
			bookingId: ID,
			ticketTypeId: "tt_a",
			name: "Ada Lovelace",
			email: "ada@example.com",
			status: "valid",
			code: "code-1",
			signature: { envelopeId: "env_1", status: "completed", docSha256: "a".repeat(64) },
		});
		w.storage.attendees.set(`${ID}-2`, {
			bookingId: ID,
			ticketTypeId: "tt_b",
			name: "Charles Babbage",
			email: "charles@example.com",
			status: "pending",
			code: "code-2",
		});
		const before = structuredClone([...w.storage.attendees.docs.entries()]);
		const pay: NonNullable<ContinueDeps["payment"]> = {
			prepare: async () => ({
				ok: true,
				value: { start: async () => ({ ok: true, value: { url: "https://pay.test/s" } }) },
			}),
		};
		const { body, calls } = await run(w.deps(T0 + MIN, { payment: pay }), w.input);
		expect(body).toMatchObject({ ok: true, status: "awaiting_payment", next: { type: "pay" } });
		expect([...w.storage.attendees.docs.entries()]).toEqual(before);
		expect(calls).toBeLessThanOrEqual(6);
	});

	it("EV-FR-12 a refusal from the step writes nothing (a code, or input issues)", async () => {
		for (const refusal of [{ code: "LICENCE_INVALID" }, { issues: [{ path: "attendees.1.email", code: "X" }] }]) {
			const w = await world();
			w.booking().waiver = WAIVER;
			const before = structuredClone(w.booking());
			const { body } = await run(w.deps(T0 + MIN, { signature: step({ holds: [] }, refusal) }), w.input);
			if ("code" in refusal) expect(body).toMatchObject({ ok: false, error: { code: "LICENCE_INVALID" } });
			else expect(body).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" }, issues: refusal.issues });
			expect(w.booking()).toEqual(before);
			expect(w.storage.attendees.docs.size + w.cron.tasks.size).toBe(0);
		}
	});

	it("EV-FR-12 a booking without a waiver never reaches the step", async () => {
		const w = await world();
		const seen: Seen = { holds: [] };
		const { body } = await run(w.deps(T0 + MIN, { signature: step(seen) }), w.input);
		expect(body).toMatchObject({ ok: true, status: "confirmed" });
		expect(seen.prepared).toBeUndefined();
	});

	it("EV-FR-12 Free (no step) ignores a waiver: Pro features off, the booking still confirms", async () => {
		const w = await world();
		w.booking().waiver = WAIVER;
		const { body } = await run(w.deps(T0 + MIN), w.input);
		expect(body).toMatchObject({ ok: true, status: "confirmed" });
	});
});
