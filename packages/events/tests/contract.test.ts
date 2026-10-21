import { createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { STORAGE_COLLECTIONS } from "../src/storage/schema";

// Runs against tests/fixtures/contract-probe (vitest.config.ts, project "contract"): the shipped
// manifest (symlink) with probe routes that call storage and ctx.http.fetch from the sandbox.

let host: PluginTestHost;

beforeEach(async () => {
	host = await createPluginTestHost();
});

afterEach(async () => {
	await host.dispose();
});

type Result = { ok: boolean; error?: string; ids?: string[]; status?: number };
const call = async (name: string, input: unknown) => (await host.invokeRoute(name, input)) as Result;

/** Two documents per collection, `a` and `b`, differing in every indexed and unique field. */
const SAMPLES: Record<string, { id: [string, string]; docs: [Record<string, unknown>, Record<string, unknown>] }> = {
	event_configs: {
		id: ["entry_a", "entry_b"],
		docs: [
			{ status: "on_sale", capacity: 100, reserved: 0, sold: 0, salesEnd: "2026-12-01T10:00:00Z", currency: "GBP" },
			{ status: "draft", capacity: 10, reserved: 0, sold: 0, salesEnd: "2026-12-02T10:00:00Z", currency: "GBP" },
		],
	},
	occurrences: {
		id: ["occ_a", "occ_b"],
		docs: [
			{ eventId: "entry_a", startsAt: "2026-12-05T18:00:00Z", status: "open", capacity: 50, reserved: 0, sold: 0 },
			{ eventId: "entry_b", startsAt: "2026-12-06T18:00:00Z", status: "closed", capacity: 50, reserved: 0, sold: 0 },
		],
	},
	ticket_types: {
		id: ["tt_a", "tt_b"],
		docs: [
			{ eventId: "entry_a", name: "Standard", priceMinor: 1000, capacity: 50, reserved: 0, sold: 0 },
			{ eventId: "entry_b", name: "VIP", priceMinor: 5000, capacity: 5, reserved: 0, sold: 0 },
		],
	},
	bookings: {
		id: ["bk_a", "bk_b"],
		docs: [
			{
				ref: "REF-A",
				eventId: "entry_a",
				status: "held",
				email: "a@example.com",
				ipHash: "iphash-a",
				createdAt: "2026-11-01T09:00:00Z",
				holdExpiresAt: "2026-11-01T09:15:00Z",
			},
			{
				ref: "REF-B",
				eventId: "entry_b",
				status: "confirmed",
				email: "b@example.com",
				ipHash: "iphash-b",
				createdAt: "2026-11-02T09:00:00Z",
				holdExpiresAt: "2026-11-02T09:15:00Z",
			},
		],
	},
	payments: {
		id: ["stripe:cs_a", "stripe:cs_b"],
		docs: [
			{ bookingId: "bk_a", provider: "stripe", status: "paid", amountMinor: 1000, currency: "GBP" },
			{ bookingId: "bk_b", provider: "stripe", status: "refunded", amountMinor: 5000, currency: "GBP" },
		],
	},
	attendees: {
		id: ["att_a", "att_b"],
		docs: [
			{
				bookingId: "bk_a",
				eventId: "entry_a",
				email: "a@example.com",
				code: "CODE-A",
				checkedInAt: "2026-12-05T17:55:00Z",
			},
			{
				bookingId: "bk_b",
				eventId: "entry_b",
				email: "b@example.com",
				code: "CODE-B",
				checkedInAt: "2026-12-06T17:55:00Z",
			},
		],
	},
	waitlist: {
		id: ["wl_a", "wl_b"],
		docs: [
			{ eventId: "entry_a", status: "waiting", offerExpiresAt: "2026-12-01T10:00:00Z", email: "a@example.com" },
			{ eventId: "entry_b", status: "offered", offerExpiresAt: "2026-12-02T10:00:00Z", email: "b@example.com" },
		],
	},
	promo_codes: {
		id: ["promo_a", "promo_b"],
		docs: [
			{ code: "SPRING", eventId: "entry_a", kind: "percent", amount: 10, maxUses: 5, uses: 0 },
			{ code: "SUMMER", eventId: "entry_b", kind: "fixed", amount: 500, maxUses: 5, uses: 0 },
		],
	},
	outbox: {
		id: ["ob_a", "ob_b"],
		docs: [
			{
				kind: "confirmation",
				to: "a@example.com",
				status: "pending",
				nextAttemptAt: "2026-11-01T09:05:00Z",
				attempts: 0,
			},
			{ kind: "reminder", to: "b@example.com", status: "sent", nextAttemptAt: "2026-11-02T09:05:00Z", attempts: 1 },
		],
	},
};

const fieldsOf = (index: string | readonly string[]): string[] => (typeof index === "string" ? [index] : [...index]);

describe("storage collections (EU-FR-01 trust contract, BUILD-PLAN 3.1)", () => {
	it("has a sample for every declared collection and no extras", () => {
		expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(STORAGE_COLLECTIONS).sort());
	});

	for (const [name, declared] of Object.entries(STORAGE_COLLECTIONS)) {
		describe(name, () => {
			const sample = SAMPLES[name];
			if (!sample) throw new Error(`no sample for ${name}`);
			const [docA, docB] = sample.docs;
			const [idA, idB] = sample.id;

			it("accepts a document", async () => {
				expect(await call("probe/put", { collection: name, id: idA, data: docA })).toEqual({ ok: true });
				expect(await host.storage(name).get(idA)).toEqual(docA);
			});

			for (const index of [...declared.indexes, ...declared.uniqueIndexes]) {
				const fields = fieldsOf(index as string | string[]);
				it(`queries by index ${fields.join("+")}`, async () => {
					await call("probe/put", { collection: name, id: idA, data: docA });
					await call("probe/put", { collection: name, id: idB, data: docB });
					const where = Object.fromEntries(fields.map((f) => [f, docA[f]]));
					const last = fields[fields.length - 1] as string;
					const result = await call("probe/query", { collection: name, where, orderBy: { [last]: "asc" } });
					expect(result).toEqual({ ok: true, ids: [idA] });
				});
			}

			// The in-memory plugin test host (@emdash-cms/plugin-test 0.2.8) indexes unique fields but does
			// not enforce uniqueness (it concatenates uniqueIndexes into plain indexes), so duplicate
			// rejection can only be proven against D1 (load tests, T110). Here we pin the declaration.
			for (const field of declared.uniqueIndexes) {
				it(`declares ${field} as a unique index in the manifest`, () => {
					expect(declared.uniqueIndexes).toContain(field);
					expect(fieldsOf(field)).toEqual([field]);
				});
			}

			if (declared.uniqueIndexes.length === 0) {
				it("accepts the same document id twice (put replaces)", async () => {
					await call("probe/put", { collection: name, id: idA, data: docA });
					expect((await call("probe/put", { collection: name, id: idA, data: docB })).ok).toBe(true);
					expect(await host.storage(name).get(idA)).toEqual(docB);
				});
			}
		});
	}

	it("rejects a query on a field that is not indexed", async () => {
		const result = await call("probe/query", { collection: "payments", where: { amountMinor: 1000 } });
		expect(result.ok).toBe(false);
	});

	it("rejects an undeclared collection", async () => {
		const result = await call("probe/put", { collection: "notDeclared", id: "x", data: {} });
		expect(result.ok).toBe(false);
	});
});

describe("network boundary (Free edition, BUILD-PLAN 13)", () => {
	it("denies ctx.http.fetch to any host other than challenges.cloudflare.com", async () => {
		for (const url of [
			"https://api.stripe.com/v1/checkout/sessions",
			"https://example.com/",
			"https://challenges.cloudflare.com.evil.example/turnstile/v0/siteverify",
		]) {
			const result = await call("probe/fetch", { url });
			expect(result.ok, url).toBe(false);
			expect(result.error, url).toMatch(/not allowed|allowed|denied|host/i);
		}
	});
});
