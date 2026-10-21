import { createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";
import { afterEach, describe, expect, it } from "vitest";
import { COLLECTIONS, type CollectionName, STORAGE_DECLARATIONS } from "../src/storage/schema";

// Runs against tests/fixtures/storage-probe, whose manifest is a symlink to the real one
// (vitest.config.ts, project "storage-host").

let host: PluginTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

type Doc = Record<string, unknown>;

/** One sample document per collection; every indexed field is present with a distinct value. */
function sample(collection: CollectionName, n: number): Doc {
	const iso = `2026-10-1${n}T00:00:00.000Z`;
	switch (collection) {
		case "templates":
			return { name: `T${n}`, kind: "text", status: n === 1 ? "published" : "draft", public: n === 1, version: n };
		case "envelopes":
			return { title: `E${n}`, status: n === 1 ? "sent" : "draft", expiresAt: iso, createdAt: iso, clientId: `c${n}`, externalRef: `r${n}` };
		case "signers":
			return { envelopeId: `env${n}`, email: `s${n}@example.com`, tokenHash: `hash${n}`, order: 0 };
		case "artifacts":
			return { envelopeId: `env${n}`, kind: "signed_pdf", chunk: 0, data: "AAAA" };
		case "snapshots":
			return { envelopeId: `env${n}`, contentType: "text/markdown", chunk: 0, data: "AAAA" };
		case "auditEvents":
			return { envelopeId: `env${n}`, seq: n, type: "created", at: iso };
		case "clients":
			return { name: `Client ${n}`, clientId: `cid${n}`, createdAt: iso };
		case "nonces":
			return { nonce: `n${n}`, expiresAt: iso };
	}
}

function fieldOf(index: string | readonly string[]): string[] {
	return typeof index === "string" ? [index] : [...index];
}

async function call(name: string, input: unknown) {
	return (await host?.invokeRoute(name, input)) as { ok: boolean; message?: string; ids?: string[]; count?: number; status?: number };
}

describe("ES storage collections accept documents and query by every declared index (T020)", () => {
	for (const collection of COLLECTIONS) {
		it(`${collection}: stores a document and queries by each index`, async () => {
			host = await createPluginTestHost();
			const first = sample(collection, 1);
			const second = sample(collection, 2);
			expect((await call("put", { collection, id: `${collection}-1`, data: first })).ok).toBe(true);
			expect((await call("put", { collection, id: `${collection}-2`, data: second })).ok).toBe(true);

			const declaration = STORAGE_DECLARATIONS[collection];
			const indexes = [...declaration.indexes, ...(declaration.uniqueIndexes ?? [])];
			expect(indexes.length).toBeGreaterThan(0);
			for (const index of indexes) {
				const where: Doc = {};
				for (const field of fieldOf(index)) where[field] = first[field];
				const result = await call("query", { collection, where });
				expect(result.ok, `${collection}.${fieldOf(index).join("+")}: ${result.message}`).toBe(true);
				expect(result.ids, `${collection}.${fieldOf(index).join("+")}`).toEqual([`${collection}-1`]);
				expect(result.count).toBe(1);
			}
		});
	}

	it("rejects a duplicate in every unique index", async () => {
		host = await createPluginTestHost();
		let checked = 0;
		for (const collection of COLLECTIONS) {
			for (const index of STORAGE_DECLARATIONS[collection].uniqueIndexes ?? []) {
				checked++;
				const first = sample(collection, 1);
				const duplicate = { ...sample(collection, 2) };
				for (const field of fieldOf(index)) duplicate[field] = first[field];
				expect((await call("put", { collection, id: `${collection}-a`, data: first })).ok).toBe(true);
				const result = await call("put", { collection, id: `${collection}-b`, data: duplicate });
				expect(result.ok, `${collection}.${fieldOf(index).join("+")}`).toBe(false);
			}
		}
		expect(checked).toBeGreaterThanOrEqual(2);
	});
});

describe("ES network allow-list (T020)", () => {
	it("permits only the Turnstile host", async () => {
		host = await createPluginTestHost();
		const denied = await call("fetch", { url: "https://example.com/" });
		expect(denied.ok).toBe(false);
		const deniedSubdomain = await call("fetch", { url: "https://evil.challenges.cloudflare.com.example.com/" });
		expect(deniedSubdomain.ok).toBe(false);
	});
});
