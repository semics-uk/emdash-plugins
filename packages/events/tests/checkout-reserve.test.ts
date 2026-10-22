import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { hashIp, hashToken, TURNSTILE_VERIFY_URL } from "@semics-tech/shared";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RESERVE_RATE_LIMIT } from "../src/domain/checkout";

// public/checkout/reserve (EV-FR-05, R9, R22) against the real plugin in workerd.

let runtime: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;

beforeEach(() => {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const body = btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${body}`;
});

afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

const ROUTE = "public/checkout/reserve";
const SECRET = "0x4AAAA-turnstile-secret";
const IP = "203.0.113.7";
/** The common order (one ticket type, no occurrence) meets the R22 design target. */
const TARGET = { calls: 8 };
const meta = (ip: string | null = IP) => ({ meta: { ip, userAgent: null, referer: null, geo: null } });

type Body = {
	ok: boolean;
	error?: { code: string };
	issues?: Array<{ path: string }>;
	bookingRef?: string;
	accessToken?: string;
	status?: string;
	holdExpiresAt?: string;
	totals?: { totalMinor: number; currency: string };
};
type Counted = { capacity: number; reserved: number };
type Booking = {
	ref: string;
	status: string;
	accessTokenHash: string;
	holdExpiresAt: string;
	holdCeilingAt: string;
	releaseClaimedAt: null;
	email: string;
	ipHash: string;
	lines: Array<{ ticketTypeId: string; qty: number; unitPriceMinor: number }>;
};

interface Setup {
	runtime: PluginRuntimeTestHost;
	budget: BudgetedHost;
	turnstile: boolean;
	types: Record<string, string>;
	occurrenceId?: string;
}

async function setup({
	turnstile = true,
	capacity = 50,
	typeCapacity = capacity,
	occurrences = false,
	signature,
}: {
	turnstile?: boolean;
	capacity?: number;
	typeCapacity?: number;
	occurrences?: boolean;
	signature?: Record<string, unknown>;
} = {}): Promise<Setup> {
	runtime = await createPluginRuntimeTestHost();
	const saved = (await runtime.transport.invokeRoute("config/save", {
		eventId: "entry_1",
		config: { status: "on_sale", capacity, currency: "GBP", ...(signature ? { signature } : {}) },
		ticketTypes: [
			{ name: "Adult", priceMinor: 0, capacity: typeCapacity },
			{ name: "Child", priceMinor: 0, capacity: typeCapacity, sort: 1 },
		],
		occurrences: occurrences ? [{ startsAt: "2099-12-05T18:00:00Z", endsAt: "2099-12-05T22:00:00Z", capacity }] : [],
	})) as { ok: boolean };
	expect(saved.ok).toBe(true);
	const loaded = (await runtime.transport.invokeRoute("config/get", { eventId: "entry_1" })) as {
		ticketTypes: Array<{ id: string; name: string }>;
		occurrences: Array<{ id: string }>;
	};
	if (turnstile) {
		await runtime.actions.plugin.updateSettings({ turnstileSecretKey: SECRET });
	}
	return {
		runtime,
		turnstile,
		budget: withBudget(runtime),
		types: Object.fromEntries(loaded.ticketTypes.map((t) => [t.name, t.id])),
		...(loaded.occurrences[0] ? { occurrenceId: loaded.occurrences[0].id } : {}),
	};
}

let keySeq = 0;
const newKey = () => `test-key-${String(++keySeq).padStart(4, "0")}-${"x".repeat(24)}`;

const order = (s: Setup, over: Record<string, unknown> = {}) => ({
	eventId: "entry_1",
	lines: [{ ticketTypeId: s.types.Adult, qty: 2 }],
	buyer: { name: "Ada Lovelace", email: "ada@example.com" },
	idempotencyKey: newKey(),
	turnstileToken: "turnstile-ok",
	...over,
});

const counter = async (s: Setup, collection: string, id: string) =>
	(await s.runtime.inspect.storage.get<Counted>(collection, id))?.reserved;
const bookings = async (s: Setup) => s.runtime.inspect.storage.list<Booking>("bookings");

/** Invoke the route; Cloudflare's answer (one per request) is armed when a token is sent. */
async function reserve(s: Setup, input: unknown, ip: string | null = IP, human = true) {
	if (s.turnstile && (input as { turnstileToken?: string } | undefined)?.turnstileToken) {
		await s.runtime.http.respond(TURNSTILE_VERIFY_URL, Response.json({ success: human }));
	}
	const result = await s.budget.invokeRoute(ROUTE, input, meta(ip));
	expectWithinBudget(result);
	return { result, body: result.value as Body };
}

describe("public/checkout/reserve (EV-FR-05)", () => {
	it("EV-FR-05 a valid request returns a booking ref and hold expiry, holding the seats", async () => {
		const s = await setup();
		const started = Date.now();
		const { result, body } = await reserve(s, order(s));
		expectWithinBudget(result, TARGET);
		expect(body).toMatchObject({ ok: true, status: "held", totals: { totalMinor: 0, currency: "GBP" } });
		expect(Object.keys(body).sort()).toEqual(
			["ok", "bookingRef", "accessToken", "status", "holdExpiresAt", "totals"].sort(),
		);
		expect(body.bookingRef).toMatch(/^[0-9A-Z]{10}$/);
		expect(body.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
		// A free hold: 15 minutes by default.
		const hold = Date.parse(body.holdExpiresAt ?? "") - started;
		expect(hold).toBeGreaterThan(14 * 60_000);
		expect(hold).toBeLessThanOrEqual(15 * 60_000 + 5_000);

		const [stored] = await bookings(s);
		expect(stored?.data).toMatchObject({
			ref: body.bookingRef,
			status: "held",
			email: "ada@example.com",
			releaseClaimedAt: null,
			lines: [{ ticketTypeId: s.types.Adult, qty: 2, unitPriceMinor: 0 }],
		});
		// Only the token's hash is stored, and the IP only as a salted hash.
		expect(stored?.data.accessTokenHash).toBe(await hashToken(body.accessToken ?? ""));
		expect(JSON.stringify(stored?.data)).not.toContain(body.accessToken);
		expect(JSON.stringify(stored?.data)).not.toContain(IP);
		expect(stored?.data.ipHash).toBe(await hashIp(IP, SECRET));

		expect(await counter(s, "ticket_types", s.types.Adult ?? "")).toBe(2);
		expect(await counter(s, "event_configs", "entry_1")).toBe(2);

		// Turnstile was verified server-side with the secret, the token and the client IP.
		const [verify] = s.runtime.http.requests();
		expect(verify?.url).toBe(TURNSTILE_VERIFY_URL);
		const form = new URLSearchParams(new TextDecoder().decode(verify?.body));
		expect(Object.fromEntries(form)).toEqual({ secret: SECRET, response: "turnstile-ok", remoteip: IP });
	});

	it("R22 an occurrence order with two ticket types (four reservation steps) stays within 10 calls", async () => {
		const s = await setup({ occurrences: true });
		const { body } = await reserve(
			s,
			order(s, {
				occurrenceId: s.occurrenceId,
				lines: [
					{ ticketTypeId: s.types.Adult, qty: 2 },
					{ ticketTypeId: s.types.Child, qty: 1 },
				],
			}),
		);
		expect(body).toMatchObject({ ok: true, status: "held" });
		expect(await counter(s, "occurrences", s.occurrenceId ?? "")).toBe(3);
		expect(await counter(s, "event_configs", "entry_1")).toBe(3);
	});

	it("EV-FR-05 sold out returns SOLD_OUT, before any write when the read shows it", async () => {
		const s = await setup({ capacity: 2 });
		const { result, body } = await reserve(s, order(s, { lines: [{ ticketTypeId: s.types.Adult, qty: 3 }] }));
		expect(body).toMatchObject({ ok: false, error: { code: "SOLD_OUT" } });
		expect(result.calls.filter((c) => c.method === "compareAndSet" || c.method === "updateIf")).toEqual([]);
		expect(await bookings(s)).toEqual([]);
	});

	it("EV-FR-05 sold out by a reservation that landed first: SOLD_OUT, no seats kept, the draft closed", async () => {
		const s = await setup({ capacity: 10, typeCapacity: 2 });
		expect((await reserve(s, order(s))).body.ok).toBe(true);
		// The catalog does not carry live counters, so this attempt reaches the guarded write.
		const { body } = await reserve(s, order(s, { lines: [{ ticketTypeId: s.types.Adult, qty: 1 }] }));
		expect(body).toMatchObject({ ok: false, error: { code: "SOLD_OUT" } });
		expect(await counter(s, "ticket_types", s.types.Adult ?? "")).toBe(2);
		expect(await counter(s, "event_configs", "entry_1")).toBe(2);
		const statuses = (await bookings(s)).map((b) => b.data.status).sort();
		expect(statuses).toEqual(["expired", "held"]);
	});

	it("EV-FR-05 a failed or missing Turnstile check returns TURNSTILE_FAILED and writes nothing", async () => {
		const s = await setup();
		const missing = await reserve(s, order(s, { turnstileToken: undefined }));
		expect(missing.body).toMatchObject({ ok: false, error: { code: "TURNSTILE_FAILED" } });
		const failed = await reserve(s, order(s), IP, false);
		expect(failed.body).toMatchObject({ ok: false, error: { code: "TURNSTILE_FAILED" } });
		expect(await bookings(s)).toEqual([]);
		expect(await counter(s, "event_configs", "entry_1")).toBe(0);
	});

	it("EV-FR-05 too many bookings from one IP returns RATE_LIMITED; another IP is unaffected", async () => {
		const s = await setup();
		const ipHash = await hashIp(IP, SECRET);
		const createdAt = new Date().toISOString();
		for (let n = 0; n < RESERVE_RATE_LIMIT.limit; n++) {
			await s.runtime.fixtures.plugin.storage("bookings", `seed_${n}`, {
				ref: `SEED${n}`,
				eventId: "other",
				status: "expired",
				ipHash,
				createdAt,
				email: "x@example.com",
				lines: [],
			});
		}
		const limited = await reserve(s, order(s));
		expect(limited.body).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
		expect(await counter(s, "event_configs", "entry_1")).toBe(0);
		const other = await reserve(s, order(s), "198.51.100.1");
		expect(other.body).toMatchObject({ ok: true });
	});

	it("EV-FR-05 a duplicate submit with the same idempotency key returns the same booking", async () => {
		const s = await setup();
		const input = order(s);
		const first = await reserve(s, input);
		const again = await reserve(s, input);
		expect(again.body).toMatchObject({ ok: true, status: "held", bookingRef: first.body.bookingRef });
		expect(again.body.holdExpiresAt).toBeDefined();
		// Seats are held once.
		expect(await counter(s, "event_configs", "entry_1")).toBe(2);
		const all = await bookings(s);
		expect(all).toHaveLength(1);
		// The token is reissued (the first response may never have arrived); the old one stops working.
		expect(again.body.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(all[0]?.data.accessTokenHash).toBe(await hashToken(again.body.accessToken ?? ""));
		expect(all[0]?.data.accessTokenHash).not.toBe(await hashToken(first.body.accessToken ?? ""));
	});

	it("EV-FR-05 a double submit whose Turnstile token was already spent still returns the booking", async () => {
		const s = await setup();
		const input = order(s);
		const first = await reserve(s, input);
		const again = await reserve(s, input, IP, false);
		expect(again.body).toMatchObject({ ok: true, bookingRef: first.body.bookingRef });
		expect(await counter(s, "event_configs", "entry_1")).toBe(2);
	});

	it("EV-FR-05 a resubmit after the hold lapsed is HOLD_EXPIRED; after confirmation it keeps the emailed token", async () => {
		const s = await setup();
		const input = order(s);
		const first = await reserve(s, input);
		const [stored] = await bookings(s);
		const id = stored?.id ?? "";
		await s.runtime.fixtures.plugin.storage("bookings", id, { ...stored?.data, status: "confirmed" });
		const confirmed = await reserve(s, input);
		expect(confirmed.body).toEqual({ ok: true, bookingRef: first.body.bookingRef, status: "confirmed" });
		expect((await bookings(s))[0]?.data.accessTokenHash).toBe(await hashToken(first.body.accessToken ?? ""));
		await s.runtime.fixtures.plugin.storage("bookings", id, { ...stored?.data, status: "expired" });
		const expired = await reserve(s, input);
		expect(expired.body).toMatchObject({ ok: false, error: { code: "HOLD_EXPIRED" } });
	});

	it("EV-FR-05 an occurrence event refuses an order without its occurrence", async () => {
		const s = await setup({ occurrences: true });
		const { body } = await reserve(s, order(s));
		expect(body).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
		expect(body.issues).toEqual([{ path: "occurrenceId", code: "OCCURRENCE_REQUIRED" }]);
	});

	it("EV-FR-05 reusing an idempotency key for a different order is refused", async () => {
		const s = await setup();
		const input = order(s);
		await reserve(s, input);
		const other = await reserve(s, { ...input, lines: [{ ticketTypeId: s.types.Adult, qty: 3 }] });
		expect(other.body).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
		expect(other.body.bookingRef).toBeUndefined();
		expect(await counter(s, "event_configs", "entry_1")).toBe(2);
	});

	it("EV-FR-05 bad input is BAD_REQUEST and an unknown event NOT_FOUND, revealing nothing", async () => {
		const s = await setup();
		const bad = await reserve(s, { ...order(s), buyer: { name: "Ada", email: "nope" } });
		expect(bad.body).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
		expect(bad.body.issues?.map((i) => i.path)).toEqual(["buyer.email"]);
		const empty = await reserve(s, undefined);
		expect(empty.body).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
		const unknown = await reserve(s, order(s, { eventId: "entry_missing" }));
		expect(unknown.body).toEqual({ ok: false, error: { code: "NOT_FOUND", message: "Not found." } });
		expect(await bookings(s)).toEqual([]);
	});

	it("T100 without a Turnstile secret the IP hash is salted with a random site secret made by the first booking (T057 F6)", async () => {
		const s = await setup({ turnstile: false, occurrences: true });
		const big = () =>
			order(s, {
				turnstileToken: undefined,
				occurrenceId: s.occurrenceId,
				lines: [
					{ ticketTypeId: s.types.Adult, qty: 1 },
					{ ticketTypeId: s.types.Child, qty: 1 },
				],
			});
		// The first booking also stores the salt: the worst-case order still fits 10 calls.
		const first = await reserve(s, big());
		expect(first.body).toMatchObject({ ok: true, status: "held" });
		const salt = await s.runtime.inspect.setting<string>("ipSalt");
		expect(salt).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const second = await reserve(s, big());
		expect(second.body).toMatchObject({ ok: true, status: "held" });
		expect(await s.runtime.inspect.setting<string>("ipSalt")).toBe(salt);
		expect(second.result.calls.length).toBeLessThan(first.result.calls.length);
		const hashes = (await bookings(s)).map((b) => b.data.ipHash);
		expect(hashes).toEqual([await hashIp(IP, salt ?? ""), await hashIp(IP, salt ?? "")]);
		expect(hashes).not.toContain(await hashIp(IP, "semics-events"));
	});

	it("EV-FR-06 schedules the hold accelerator when the budget has room (no Turnstile configured)", async () => {
		const s = await setup({ turnstile: false });
		// The site's first booking stores the IP salt (T100), which leaves no room for the accelerator.
		await reserve(s, order(s, { turnstileToken: undefined }));
		const { result, body } = await reserve(s, order(s, { turnstileToken: undefined }));
		expect(body).toMatchObject({ ok: true });
		expectWithinBudget(result, TARGET);
		const tasks = await s.runtime.inspect.scheduledTasks();
		expect(JSON.stringify(tasks)).toContain(`hold-${body.bookingRef}`);
	});

	it("EV-FR-12 a waiver-required event's booking keeps the waiver it was booked under; others carry none", async () => {
		const s = await setup({ signature: { required: true, templateId: "tpl_waiver", mode: "buyer" } });
		const { result, body } = await reserve(s, order(s));
		expectWithinBudget(result, TARGET);
		const [stored] = await bookings(s);
		expect(stored?.data).toMatchObject({ ref: body.bookingRef, waiver: { templateId: "tpl_waiver", mode: "buyer" } });

		await s.runtime.dispose();
		const plain = await setup({ signature: { required: false, templateId: "tpl_waiver" } });
		await reserve(plain, order(plain));
		const [none] = await bookings(plain);
		expect(none?.data).not.toHaveProperty("waiver");
	});
});
