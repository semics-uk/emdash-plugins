import { hashToken } from "@semics-tech/shared";
import { describe, expect, it } from "vitest";
import type { SignerDoc } from "../src/domain/envelopes";
import { masterKeyBytes } from "../src/domain/master-key";
import { insertSigner, type SignerStore } from "../src/routes/envelopes";

const build = (tokenHash: string): SignerDoc => ({
	envelopeId: "e1",
	order: 1,
	role: "signer",
	name: "Ada",
	email: "ada@example.com",
	as: "self",
	status: "pending",
	tokenHash,
	createdAt: "2026-10-21T10:00:00.000Z",
});

let seed = 0;
const random = (n: number) => new Uint8Array(n).fill(++seed);

describe("ES-FR-02 signer token stored as hash only", () => {
	it("ES-FR-02 returns the token once and stores only its SHA-256", async () => {
		const puts: Array<{ id: string; data: SignerDoc }> = [];
		const store: SignerStore = { put: async (id, data) => void puts.push({ id, data }) };
		const token = await insertSigner(store, "e1:s1", build, random);
		expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
		expect(puts).toHaveLength(1);
		expect(puts[0]?.data.tokenHash).toBe(await hashToken(token));
		expect(JSON.stringify(puts)).not.toContain(token);
	});

	it("ES-FR-02 retries with a fresh token when D1 rejects a duplicate tokenHash (R26, faked)", async () => {
		const hashes: string[] = [];
		let failures = 1;
		const store: SignerStore = {
			async put(_id, data) {
				hashes.push(data.tokenHash);
				if (failures-- > 0) throw new Error("D1_ERROR: UNIQUE constraint failed: index 'uidx_signers_tokenHash'");
			},
		};
		const token = await insertSigner(store, "e1:s1", build, random);
		expect(hashes).toHaveLength(2);
		expect(hashes[0]).not.toBe(hashes[1]);
		expect(hashes[1]).toBe(await hashToken(token));
	});

	it("gives up after repeated collisions and rethrows other storage errors", async () => {
		const always: SignerStore = {
			put: async () => {
				throw new Error("UNIQUE constraint failed: index 'uidx_x'");
			},
		};
		await expect(insertSigner(always, "e1:s1", build, random)).rejects.toThrow(/UNIQUE/);
		let calls = 0;
		const broken: SignerStore = {
			put: async () => {
				calls++;
				throw new Error("disk on fire");
			},
		};
		await expect(insertSigner(broken, "e1:s1", build, random)).rejects.toThrow("disk on fire");
		expect(calls).toBe(1);
	});
});

describe("integrationMasterKey bytes", () => {
	it("uses the UTF-8 bytes of the trimmed setting and refuses short or missing keys", () => {
		expect(masterKeyBytes(` ${"k".repeat(32)} `)).toEqual(new TextEncoder().encode("k".repeat(32)));
		expect(masterKeyBytes("k".repeat(31))).toBeNull();
		expect(masterKeyBytes(null)).toBeNull();
		expect(masterKeyBytes(42)).toBeNull();
	});
});
