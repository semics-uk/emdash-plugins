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
			return {
				name: `T${n}`,
				kind: n === 1 ? "text" : "pdf",
				status: n === 1 ? "published" : "draft",
				public: n === 1,
				version: n,
			};
		case "envelopes":
			return {
				title: `E${n}`,
				status: n === 1 ? "sent" : "draft",
				expiresAt: iso,
				createdAt: iso,
				clientId: `c${n}`,
				externalRef: `r${n}`,
				pdfSha256: `p${n}`,
				signerEmail: `s${n}@example.com`,
			};
		case "signers":
			return {
				envelopeId: `env${n}`,
				email: `s${n}@example.com`,
				tokenHash: `hash${n}`,
				copyTokenHash: `copy${n}`,
				order: 0,
			};
		case "artifacts":
			return { envelopeId: `env${n}`, kind: "signed_pdf", chunk: 0, data: "AAAA" };
		case "snapshots":
			return { envelopeId: `env${n}`, contentType: "text/markdown", chunk: 0, data: "AAAA" };
		case "audit_events":
			return { envelopeId: `env${n}`, seq: n, type: "created", at: iso };
		case "clients":
			return { name: `Client ${n}`, clientId: `cid${n}`, createdAt: iso };
		case "nonces":
			return { nonce: `n${n}`, expiresAt: iso };
		case "outbox":
			return { status: n === 1 ? "pending" : "sent", nextAttemptAt: n };
	}
}

function fieldOf(index: string | readonly string[]): string[] {
	return typeof index === "string" ? [index] : [...index];
}

async function call(name: string, input: unknown) {
	return (await host?.invokeRoute(name, input)) as {
		ok: boolean;
		message?: string;
		ids?: string[];
		count?: number;
		status?: number;
	};
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

	// Unique indexes are declared in the manifest and enforced by the site database. The sandbox test
	// host creates no database unique constraint, so duplicate rejection cannot be asserted here.
	it("declares the unique indexes (token hash, nonce)", () => {
		const unique = COLLECTIONS.flatMap((name) => STORAGE_DECLARATIONS[name].uniqueIndexes ?? []);
		expect(unique).toEqual(expect.arrayContaining(["tokenHash", "nonce"]));
	});

	// T135: EmDash 1.2 builds a unique index as `(plugin_id, collection, field)` over the plugin's whole
	// storage, not only the declaring collection, so a field it makes unique must not be a field of any
	// other collection's documents. `clients.clientId` was: every envelope carries its client's id, and
	// a site's second envelope from one integration client failed with a UNIQUE constraint error (the
	// playground's waiver e2e). A client's document id is its client id, which keeps it unique.
	it("no unique field is a field of another collection's documents", () => {
		for (const owner of COLLECTIONS) {
			for (const field of (STORAGE_DECLARATIONS[owner].uniqueIndexes ?? []).flatMap(fieldOf)) {
				for (const other of COLLECTIONS.filter((c) => c !== owner)) {
					expect(Object.keys(sample(other, 1)), `${owner}.${field} is also a field of ${other}`).not.toContain(field);
				}
			}
		}
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
