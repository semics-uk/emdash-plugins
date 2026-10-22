import { generateToken, hashToken } from "@semics-tech/shared";
import { beforeEach, describe, expect, it } from "vitest";

import type { VerifiedReceipt } from "../../src/domain/receipts";
import {
	RECEIPT_MAX_CALLS,
	RECEIPT_TARGET_CALLS,
	type ReceiptDeps,
	type ReceiptStep,
	type ReceiptStorage,
	recordReceipt,
} from "../../src/routes/receipt";
import { makeStore, meter } from "../domain/fake-storage";

// `signatures/receipt` (EV-FR-12, SX-FR-04; esign-intent/1 §8.4) with injected time and storage.
// The Free core owns the bookkeeping (ref → booking and seat, idempotent and monotonic storage,
// moving the booking out of `awaiting_signature`); the Pro step verifies the token and says which
// attendees the booking waits for. Free has no step: the route answers NOT_FOUND.

const MIN = 60_000;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * MIN).toISOString();
const ID = "bk_0123456789abcdef0123456789abcdef";
const REF = "ABCDEFGHJK";
const H = (c: string) => c.repeat(64);
type Doc = Record<string, unknown>;

beforeEach(() => {
	meter.calls = 0;
});

/** A fake e-sign receipt "token": the step decodes it; `forged` fails verification. */
const token = (r: Partial<VerifiedReceipt>) => JSON.stringify(r);
const receipt = (over: Partial<VerifiedReceipt> = {}): VerifiedReceipt => ({
	envelopeId: "env_1",
	ref: `${REF}:1`,
	status: "completed",
	docSha256: H("a"),
	pdfSha256: H("b"),
	finalHash: H("c"),
	at: Math.floor(T0 / 1000),
	...over,
});

/** Seats 1 and 2 are the buyer and a minor (signed inline); seat 3 an adult who signs by email. */
function step(awaited: string[] = [`${ID}-1`, `${ID}-2`]): ReceiptStep & { seen: Doc[] } {
	const seen: Doc[] = [];
	return {
		seen,
		async verify(raw, settings) {
			seen.push(settings);
			if (raw === "forged") return { ok: false, error: "TOKEN_INVALID" };
			return { ok: true, value: JSON.parse(raw) as VerifiedReceipt };
		},
		awaited: () => awaited,
	};
}

async function world({
	status = "awaiting_signature",
	priceMinor = 0,
	mode = "each_attendee",
	seats = 3,
	occurrence = false,
}: {
	status?: string;
	priceMinor?: number;
	mode?: string;
	seats?: number;
	occurrence?: boolean;
} = {}) {
	const storage = makeStore();
	const counted = (capacity: number) => ({ capacity, reserved: seats, sold: 0 });
	storage.event_configs.set("ev1", { status: "on_sale", ...counted(100) });
	storage.ticket_types.set("tt_a", { eventId: "ev1", ...counted(100) });
	if (occurrence) storage.occurrences.set("oc1", { eventId: "ev1", ...counted(100) });
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
		lines: [{ ticketTypeId: "tt_a", qty: seats, unitPriceMinor: priceMinor }],
		totals: { subtotalMinor: priceMinor * seats, discountMinor: 0, totalMinor: priceMinor * seats, currency: "GBP" },
		answers: {},
		waiver: { templateId: "tpl_waiver", mode },
		accessTokenHash: await hashToken(generateToken()),
		createdAt: at(0),
	});
	const people = [
		{ name: "Ada Lovelace", email: "ada@example.com" },
		{ name: "Byron", email: "ada@example.com", minor: true },
		{ name: "Charles Babbage", email: "charles@example.com" },
	];
	for (let n = 1; n <= seats; n++) {
		storage.attendees.set(`${ID}-${n}`, {
			bookingId: ID,
			eventId: "ev1",
			ticketTypeId: "tt_a",
			...(people[n - 1] ?? { name: `Guest ${n}`, email: `g${n}@example.com` }),
			code: `CODE-${n}`,
			status: "pending",
		});
	}
	const deps = (now: number, extra: Partial<ReceiptDeps> = {}): ReceiptDeps => ({
		storage: storage as unknown as ReceiptStorage,
		settings: {
			list: async () => {
				meter.calls++;
				return [{ key: "esignPairing", value: "esign1.cl_x.secret" }];
			},
		},
		step: step(),
		now,
		...extra,
	});
	const booking = () => storage.bookings.docs.get(ID) as Doc;
	const attendee = (n: number) => storage.attendees.docs.get(`${ID}-${n}`) as Doc;
	return { storage, deps, booking, attendee };
}

const run = async (deps: ReceiptDeps, input: unknown) => {
	meter.calls = 0;
	const body = (await recordReceipt(deps, input)) as Doc & { error?: { code: string } };
	const calls = meter.calls;
	expect(calls).toBeLessThanOrEqual(RECEIPT_MAX_CALLS);
	return { body, calls };
};
const post = (r: Partial<VerifiedReceipt>) => ({ receipt: token(r) });

describe("signatures/receipt confirms a waiver booking (EV-FR-12, SX-FR-04)", () => {
	it("EV-FR-12 a valid receipt marks its attendee valid, stores the envelope, and keeps the booking waiting", async () => {
		const w = await world();
		const { body, calls } = await run(w.deps(T0 + MIN), post(receipt()));
		expect(body).toEqual({
			ok: true,
			bookingRef: REF,
			status: "awaiting_signature",
			signature: { ref: `${REF}:1`, status: "completed", pdfPending: false },
		});
		expect(w.attendee(1)).toMatchObject({
			status: "valid",
			signature: { envelopeId: "env_1", status: "completed", docSha256: H("a"), pdfSha256: H("b"), finalHash: H("c") },
		});
		expect(w.attendee(2)).toMatchObject({ status: "pending" });
		// Each step extends the hold (BUILD-PLAN §3.1 Holds): one more free period from now.
		expect(w.booking()).toMatchObject({ status: "awaiting_signature", holdExpiresAt: at(1 + 15) });
		expect(calls).toBeLessThanOrEqual(RECEIPT_TARGET_CALLS);
	});

	it("EV-FR-12 when every awaited attendee has signed, a free booking confirms: sold counted, confirmation queued", async () => {
		const w = await world();
		await run(w.deps(T0 + MIN), post(receipt()));
		const { body, calls } = await run(
			w.deps(T0 + 2 * MIN),
			post(receipt({ envelopeId: "env_2", ref: `${REF}:2`, pdfSha256: null })),
		);
		expect(body).toEqual({
			ok: true,
			bookingRef: REF,
			status: "confirmed",
			signature: { ref: `${REF}:2`, status: "completed", pdfPending: true },
		});
		expect(w.booking()).toMatchObject({ status: "confirmed", confirmedAt: at(2) });
		expect(w.storage.ticket_types.docs.get("tt_a")).toMatchObject({ sold: 3 });
		expect(w.storage.event_configs.docs.get("ev1")).toMatchObject({ sold: 3 });
		expect(w.storage.outbox.docs.get(`confirm-${ID}`)).toMatchObject({
			kind: "booking_confirmed",
			payload: { bookingId: ID, bookingRef: REF },
		});
		// The adult who signs by email stays pending: check-in refuses them until they sign.
		expect(w.attendee(3)).toMatchObject({ status: "pending" });
		expect(calls).toBeLessThanOrEqual(RECEIPT_TARGET_CALLS);
	});

	it("EV-FR-12 with an occurrence the confirm stays within the hard limit", async () => {
		const w = await world({ occurrence: true, seats: 2 });
		const deps = w.deps(T0 + MIN, { step: step([`${ID}-1`]) });
		const { body, calls } = await run(deps, post(receipt()));
		expect(body).toMatchObject({ ok: true, status: "confirmed" });
		expect(w.storage.occurrences.docs.get("oc1")).toMatchObject({ sold: 2 });
		expect(calls).toBeLessThanOrEqual(RECEIPT_MAX_CALLS);
	});

	it("EV-FR-12 a paid booking moves on to awaiting_payment (the next continue starts the payment)", async () => {
		const w = await world({ priceMinor: 1500 });
		const deps = w.deps(T0 + MIN, { step: step([`${ID}-1`]) });
		const { body } = await run(deps, post(receipt()));
		expect(body).toMatchObject({ ok: true, status: "awaiting_payment" });
		expect(w.booking()).toMatchObject({ status: "awaiting_payment", holdExpiresAt: at(1 + 35) });
		expect(w.storage.outbox.docs.size).toBe(0);
	});

	it("EV-FR-12 mode buyer: one receipt for the booking signs every seat", async () => {
		const w = await world({ mode: "buyer", seats: 2 });
		const deps = w.deps(T0 + MIN, { step: step([`${ID}-1`, `${ID}-2`]) });
		const { body } = await run(deps, post(receipt({ ref: REF })));
		expect(body).toMatchObject({ ok: true, status: "confirmed" });
		expect(w.attendee(1)).toMatchObject({ status: "valid", signature: { envelopeId: "env_1" } });
		expect(w.attendee(2)).toMatchObject({ status: "valid", signature: { envelopeId: "env_1" } });
	});

	it("EV-FR-12 a late email signer on a confirmed booking becomes valid; the booking is untouched", async () => {
		const w = await world({ status: "confirmed" });
		const before = structuredClone(w.booking());
		const { body, calls } = await run(w.deps(T0 + 3 * 24 * 60 * MIN), post(receipt({ ref: `${REF}:3` })));
		expect(body).toMatchObject({ ok: true, status: "confirmed", signature: { ref: `${REF}:3` } });
		expect(w.attendee(3)).toMatchObject({ status: "valid", signature: { status: "completed" } });
		expect(w.booking()).toEqual(before);
		expect(calls).toBeLessThanOrEqual(5);
	});

	it("EV-FR-12 declined, voided and expired receipts are recorded; the attendee stays pending and the booking waits", async () => {
		for (const status of ["declined", "voided", "expired"] as const) {
			const w = await world();
			const { body } = await run(w.deps(T0 + MIN), post(receipt({ status, pdfSha256: null, finalHash: null })));
			expect(body, status).toMatchObject({ ok: true, status: "awaiting_signature", signature: { status } });
			expect(w.attendee(1)).toMatchObject({ status: "pending", signature: { status, envelopeId: "env_1" } });
			expect(w.storage.outbox.docs.size).toBe(0);
		}
	});

	it("EV-FR-12 a cancelled booking's attendee keeps its status when a receipt arrives", async () => {
		const w = await world({ status: "cancelled" });
		w.storage.attendees.set(`${ID}-1`, { ...w.attendee(1), status: "cancelled" });
		const { body } = await run(w.deps(T0 + MIN), post(receipt()));
		expect(body).toMatchObject({ ok: true, status: "cancelled" });
		expect(w.attendee(1)).toMatchObject({ status: "cancelled", signature: { status: "completed" } });
	});

	it("EV-FR-12 a receipt after the hold lapsed is stored as evidence but confirms nothing", async () => {
		const w = await world();
		const deps = w.deps(T0 + 16 * MIN, { step: step([`${ID}-1`]) });
		const { body } = await run(deps, post(receipt()));
		expect(body).toMatchObject({ ok: false, error: { code: "HOLD_EXPIRED" } });
		expect(w.attendee(1)).toMatchObject({ signature: { status: "completed" } });
		expect(w.booking()).toMatchObject({ status: "awaiting_signature" });
	});

	it("EV-FR-12 an expirer that claimed the booking first wins: no confirm (guarded on releaseClaimedAt)", async () => {
		const w = await world();
		w.storage.bookings.beforeUpdate = (id) => {
			if (id === ID) w.storage.bookings.docs.set(ID, { ...w.booking(), releaseClaimedAt: at(1) });
		};
		const { body } = await run(w.deps(T0 + MIN, { step: step([`${ID}-1`]) }), post(receipt()));
		expect(body).toMatchObject({ ok: false, error: { code: "HOLD_EXPIRED" } });
		expect(w.booking()).toMatchObject({ status: "awaiting_signature" });
		expect(w.storage.outbox.docs.size).toBe(0);
		expect(w.storage.ticket_types.docs.get("tt_a")).toMatchObject({ sold: 0 });
	});
});

describe("signatures/receipt refuses forged, unknown and malformed receipts (SX-FR-04)", () => {
	it("SX-FR-04 a forged receipt is rejected with the verifier's code and writes nothing", async () => {
		const w = await world();
		const before = structuredClone([...w.storage.attendees.docs]);
		const { body, calls } = await run(w.deps(T0 + MIN), { receipt: "forged" });
		expect(body).toMatchObject({ ok: false, error: { code: "TOKEN_INVALID" } });
		expect([...w.storage.attendees.docs]).toEqual(before);
		expect(calls).toBe(1);
	});

	it("SX-FR-04 the step gets the settings read once for the pairing", async () => {
		const w = await world();
		const s = step();
		await run(w.deps(T0 + MIN, { step: s }), post(receipt()));
		expect(s.seen).toEqual([{ esignPairing: "esign1.cl_x.secret" }]);
	});

	it("SX-FR-04 a ref it never issued is REF_UNKNOWN (unknown booking, seat, mode, or no waiver)", async () => {
		const w = await world();
		for (const ref of ["ZZZZZZZZZZ:1", `${REF}:9`, REF, "not a ref"]) {
			const { body } = await run(w.deps(T0 + MIN), post(receipt({ ref })));
			expect(body, ref).toMatchObject({ ok: false, error: { code: "REF_UNKNOWN" } });
		}
		delete w.booking().waiver;
		const { body } = await run(w.deps(T0 + MIN), post(receipt()));
		expect(body).toMatchObject({ ok: false, error: { code: "REF_UNKNOWN" } });
		expect(w.attendee(1)).toMatchObject({ status: "pending" });
		expect(w.attendee(1)).not.toHaveProperty("signature");
	});

	it("SX-FR-04 bad input is BAD_REQUEST before anything is read", async () => {
		const w = await world();
		for (const input of [undefined, null, "x", {}, { receipt: 1 }, { receipt: "" }, { receipt: "x".repeat(5000) }]) {
			const { body, calls } = await run(w.deps(T0 + MIN), input);
			expect(body, JSON.stringify(input)).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
			expect(calls).toBe(0);
		}
	});

	it("SX-FR-04 Free (no step) answers NOT_FOUND and reads nothing", async () => {
		const w = await world();
		const { body, calls } = await run(w.deps(T0 + MIN, { step: undefined }), post(receipt()));
		expect(body).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
		expect(calls).toBe(0);
	});

	it("EV-NFR-06 the answer carries no personal data or check-in codes", async () => {
		const w = await world();
		const { body } = await run(w.deps(T0 + MIN), post(receipt()));
		const text = JSON.stringify(body);
		for (const secret of ["ada@example.com", "Ada Lovelace", "CODE-1", H("a"), "env_1"])
			expect(text).not.toContain(secret);
	});
});

describe("signatures/receipt is idempotent (SX-FR-04, §8.4)", () => {
	it("SX-FR-04 the same receipt twice writes nothing the second time", async () => {
		const w = await world();
		await run(w.deps(T0 + MIN), post(receipt()));
		const attendees = structuredClone([...w.storage.attendees.docs]);
		const booking = structuredClone(w.booking());
		const { body } = await run(w.deps(T0 + 2 * MIN), post(receipt()));
		expect(body).toMatchObject({ ok: true, status: "awaiting_signature", signature: { status: "completed" } });
		expect([...w.storage.attendees.docs]).toEqual(attendees);
		expect(w.booking()).toEqual(booking);
	});

	it("SX-FR-04 SX-NFR-05 replaying the confirming receipt changes nothing and never counts sold twice", async () => {
		const w = await world({ seats: 1 });
		const deps = (now: number) => w.deps(now, { step: step([`${ID}-1`]) });
		await run(deps(T0 + MIN), post(receipt()));
		const outbox = structuredClone([...w.storage.outbox.docs]);
		const { body, calls } = await run(deps(T0 + 2 * MIN), post(receipt()));
		expect(body).toMatchObject({ ok: true, status: "confirmed" });
		expect(w.storage.ticket_types.docs.get("tt_a")).toMatchObject({ sold: 1 });
		expect([...w.storage.outbox.docs]).toEqual(outbox);
		expect(calls).toBeLessThanOrEqual(5);
	});

	it("SX-FR-04 a replay after a crash before the confirmation was queued queues it (once)", async () => {
		const w = await world({ seats: 1, status: "confirmed" });
		w.storage.attendees.set(`${ID}-1`, {
			...w.attendee(1),
			status: "valid",
			signature: {
				envelopeId: "env_1",
				status: "completed",
				docSha256: H("a"),
				pdfSha256: H("b"),
				finalHash: H("c"),
				at: Math.floor(T0 / 1000),
			},
		});
		const { body } = await run(w.deps(T0 + MIN, { step: step([`${ID}-1`]) }), post(receipt()));
		expect(body).toMatchObject({ ok: true, status: "confirmed" });
		expect(w.storage.outbox.docs.has(`confirm-${ID}`)).toBe(true);
	});

	it("SX-FR-04 a completed receipt is never replaced by a later declined one for the same seat", async () => {
		const w = await world();
		await run(w.deps(T0 + MIN), post(receipt()));
		await run(
			w.deps(T0 + 2 * MIN),
			post(
				receipt({
					envelopeId: "env_9",
					status: "declined",
					pdfSha256: null,
					finalHash: null,
					at: Math.floor(T0 / 1000) + 60,
				}),
			),
		);
		expect(w.attendee(1)).toMatchObject({ status: "valid", signature: { envelopeId: "env_1", status: "completed" } });
	});

	it("SX-FR-04 the PDF hash arriving later (lookup) supersedes the null one", async () => {
		const w = await world();
		await run(w.deps(T0 + MIN), post(receipt({ pdfSha256: null })));
		const { body } = await run(w.deps(T0 + 2 * MIN), post(receipt()));
		expect(body).toMatchObject({ signature: { pdfPending: false } });
		expect(w.attendee(1)).toMatchObject({ signature: { pdfSha256: H("b") } });
	});
});

describe("signatures/receipt extras from the step", () => {
	it("SX-FR-04 the step may add fields to the answer (a lookup request while the PDF is pending)", async () => {
		const w = await world();
		const s: ReceiptStep = { ...step(), extras: async (r) => (r.pdfSha256 === null ? { lookup: "lookup-token" } : {}) };
		const { body } = await run(w.deps(T0 + MIN, { step: s }), post(receipt({ pdfSha256: null })));
		expect(body).toMatchObject({ ok: true, lookup: "lookup-token" });
	});
});
