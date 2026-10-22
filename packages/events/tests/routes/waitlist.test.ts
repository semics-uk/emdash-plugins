import { hashIp } from "@semics-tech/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { type JoinDeps, joinWaitlist } from "../../src/routes/waitlist";
import { FakeKv, makeStore, meter } from "../domain/fake-storage";

// public/waitlist/join with injected storage, KV, Turnstile and time (EV-FR-16, EV-US-6, R22): bad
// input, unknown or closed events, the bot check, the per-IP limit, duplicates, and an answer that
// carries nothing about anyone else.

const T0 = Date.parse("2026-11-01T12:00:00.000Z");

beforeEach(() => {
	meter.calls = 0;
});

/** KV with the shared rate limiter's `set(key, value, options)` shape. */
class Kv extends FakeKv {
	async set(key: string, value: unknown) {
		const current = this.values.get(key)?.revision ?? null;
		await this.compareAndSet(key, current, value);
	}
}

function world({
	settings = [] as Array<{ key: string; value: unknown }>,
	occurrence = false,
	waitlistEnabled = true,
	human = true,
} = {}) {
	const storage = makeStore();
	storage.event_configs.set("ev1", {
		status: "on_sale",
		capacity: 2,
		reserved: 2,
		sold: 2,
		currency: "GBP",
		waitlistEnabled,
		catalog: {
			ticketTypes: {
				tt1: { capacity: 2, priceMinor: 0, hidden: false },
				tt_hidden: { capacity: 2, priceMinor: 0, hidden: true },
			},
			occurrences: occurrence ? { oc1: { capacity: 2, startsAt: "2026-12-01T19:00:00.000Z", status: "open" } } : {},
		},
	});
	const kv = new Kv();
	const fetched: string[] = [];
	const saved = new Map<string, unknown>();
	let ids = 0;
	const deps = (over: Partial<JoinDeps> = {}): JoinDeps => ({
		storage: storage as unknown as JoinDeps["storage"],
		settings: {
			list: async () => {
				meter.calls++;
				return settings;
			},
			set: async (key: string, value: unknown) => {
				meter.calls++;
				saved.set(key, value);
			},
		},
		kv,
		fetch: async (url) => {
			meter.calls++;
			fetched.push(String(url));
			return new Response(JSON.stringify({ success: human }), { headers: { "content-type": "application/json" } });
		},
		ip: "203.0.113.5",
		now: T0,
		newId: () => `wl_${++ids}`,
		...over,
	});
	return { storage, kv, deps, fetched, saved };
}

const join = { eventId: "ev1", name: "Ada Lovelace", email: " Ada@Example.com ", qty: 2 };

describe("public/waitlist/join IP salt (T100, T057 review F6)", () => {
	it("without a Turnstile secret the limiter's IP hash uses the site's random salt, never the plugin id", async () => {
		const w = world();
		await joinWaitlist(w.deps(), join);
		const salt = w.saved.get("ipSalt") as string;
		expect(salt).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const keys = [...w.kv.values.keys()].join(" ");
		expect(keys).toContain(await hashIp("203.0.113.5", salt));
		expect(keys).not.toContain(await hashIp("203.0.113.5", "semics-events"));
		expect(meter.calls).toBeLessThanOrEqual(8);
	});

	it("a stored salt is reused and not written again", async () => {
		const w = world({ settings: [{ key: "ipSalt", value: "s".repeat(43) }] });
		await joinWaitlist(w.deps(), join);
		expect(w.saved.size).toBe(0);
		expect([...w.kv.values.keys()].join(" ")).toContain(await hashIp("203.0.113.5", "s".repeat(43)));
	});
});

describe("public/waitlist/join (EV-FR-16, EV-US-6)", () => {
	it("EV-US-6 joins a sold-out event's waitlist within budget and answers nothing else", async () => {
		const w = world();
		const out = await joinWaitlist(w.deps(), join);
		expect(out).toEqual({ ok: true });
		expect(meter.calls).toBeLessThanOrEqual(8);
		expect(w.storage.waitlist.docs.get("wl_1")).toEqual({
			eventId: "ev1",
			email: "ada@example.com",
			name: "Ada Lovelace",
			qty: 2,
			status: "waiting",
			createdAt: new Date(T0).toISOString(),
		});
	});

	it("EV-US-6 refuses bad input with the issues, before any call", async () => {
		const w = world();
		const out = (await joinWaitlist(w.deps(), { eventId: "ev1", email: "nope", qty: 0, extra: 1 })) as {
			ok: boolean;
			error: { code: string };
			issues: Array<{ path: string }>;
		};
		expect(out).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
		expect(out.issues.map((i) => i.path).sort()).toEqual(["email", "input", "name", "qty"]);
		expect(meter.calls).toBe(0);
	});

	it("EV-US-6 an unknown event, or one without a waitlist, is NOT_FOUND", async () => {
		const w = world({ waitlistEnabled: false });
		expect(await joinWaitlist(w.deps(), join)).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
		expect(await joinWaitlist(w.deps(), { ...join, eventId: "ev_x" })).toMatchObject({ error: { code: "NOT_FOUND" } });
		expect(w.storage.waitlist.docs.size).toBe(0);
	});

	it("EV-US-6 a date is required for an event with dates, and a ticket type must be a listed one", async () => {
		const w = world({ occurrence: true });
		expect(await joinWaitlist(w.deps(), join)).toMatchObject({ error: { code: "BAD_REQUEST" } });
		expect(await joinWaitlist(w.deps(), { ...join, occurrenceId: "oc_x" })).toMatchObject({
			error: { code: "BAD_REQUEST" },
		});
		expect(await joinWaitlist(w.deps(), { ...join, occurrenceId: "oc1", ticketTypeId: "tt_hidden" })).toMatchObject({
			error: { code: "BAD_REQUEST" },
		});
		expect(await joinWaitlist(w.deps(), { ...join, occurrenceId: "oc1", ticketTypeId: "tt1" })).toEqual({ ok: true });
		expect(w.storage.waitlist.docs.get("wl_1")).toMatchObject({ occurrenceId: "oc1", ticketTypeId: "tt1" });
	});

	it("EV-US-6 joining twice keeps one place in the queue (same answer, nothing revealed)", async () => {
		const w = world();
		await joinWaitlist(w.deps(), join);
		expect(await joinWaitlist(w.deps(), { ...join, name: "Someone Else" })).toEqual({ ok: true });
		expect(w.storage.waitlist.docs.size).toBe(1);
	});

	it("EV-US-6 with a Turnstile secret the bot check must pass", async () => {
		const w = world({ settings: [{ key: "turnstileSecretKey", value: "s3cret" }], human: false });
		expect(await joinWaitlist(w.deps(), { ...join, turnstileToken: "tok" })).toMatchObject({
			error: { code: "TURNSTILE_FAILED" },
		});
		expect(w.fetched).toEqual(["https://challenges.cloudflare.com/turnstile/v0/siteverify"]);
		expect(w.storage.waitlist.docs.size).toBe(0);
	});

	it("EV-US-6 one connection may join only a few times in ten minutes (shared per-IP limit)", async () => {
		const w = world();
		const codes: string[] = [];
		for (let i = 0; i < 7; i++) {
			const out = (await joinWaitlist(w.deps(), { ...join, email: `p${i}@example.com` })) as {
				ok: boolean;
				error?: { code: string };
			};
			codes.push(out.ok ? "ok" : (out.error?.code ?? ""));
		}
		expect(codes).toEqual(["ok", "ok", "ok", "ok", "ok", "RATE_LIMITED", "RATE_LIMITED"]);
		expect(w.storage.waitlist.docs.size).toBe(5);
		// Another connection is not affected; the stored key holds no IP.
		expect(await joinWaitlist(w.deps({ ip: "198.51.100.1" }), { ...join, email: "x@example.com" })).toEqual({
			ok: true,
		});
		expect(JSON.stringify([...w.kv.values.keys()])).not.toContain("203.0.113.5");
	});
});
