import { sha256Hex } from "@semics-tech/shared";
import { describe, expect, it } from "vitest";
import {
	AUDIT_GENESIS,
	type AuditEventDoc,
	type AuditInput,
	type AuditStore,
	appendAuditEvent,
	auditEventId,
	commitPersonal,
	finalEnvelopeHash,
	initialAuditEvents,
	newPiiSalt,
	purgePersonal,
	verifyAuditChain,
} from "../src/domain/audit";

const ENV = "env1";
const SALT = "ab".repeat(32);

const input = (n: number, over: Partial<AuditInput> = {}): AuditInput => ({
	type: n === 0 ? "envelope.created" : "envelope.sent",
	at: `2026-10-21T10:00:0${n}.000Z`,
	actor: "admin",
	data: { n, templateId: "tpl1", ok: true, none: null },
	personal: { name: "Ada Lovelace", email: "ada@example.com" },
	...over,
});

async function chain(length = 4): Promise<AuditEventDoc[]> {
	const docs = await initialAuditEvents(
		ENV,
		Array.from({ length }, (_, n) => input(n)),
		SALT,
	);
	return docs.map((d) => d.data);
}

/** An in-memory `audit_events` store with real create-only compare-and-set semantics. */
function memoryStore(): AuditStore & { rows: Map<string, AuditEventDoc> } {
	const rows = new Map<string, AuditEventDoc>();
	const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
	return {
		rows,
		async query({ where }) {
			await tick();
			const items = [...rows]
				.filter(([, d]) => d.envelopeId === where.envelopeId)
				.sort(([, a], [, b]) => b.seq - a.seq)
				.slice(0, 1)
				.map(([id, data]) => ({ id, data }));
			return { items };
		},
		async compareAndSet(id, _expected, data) {
			await tick();
			if (rows.has(id)) return { applied: false };
			rows.set(id, data);
			return { applied: true };
		},
	};
}

const ordered = (store: { rows: Map<string, AuditEventDoc> }) =>
	[...store.rows.values()].filter((d) => d.envelopeId === ENV).sort((a, b) => a.seq - b.seq);

describe("ES-FR-05 audit events are hash-chained", () => {
	it("ES-FR-05 hash_n = SHA256(hash_n-1 ‖ event): the first event links to the genesis hash", async () => {
		const [first, second] = await chain(2);
		expect(first?.prevHash).toBe(AUDIT_GENESIS);
		expect(first?.seq).toBe(0);
		expect(second?.prevHash).toBe(first?.hash);
		expect(second?.seq).toBe(1);
		expect(first?.hash).toMatch(/^[0-9a-f]{64}$/);
		expect(first?.hash).not.toBe(second?.hash);
	});

	it("ES-FR-05 the hash covers commitments, never the raw personal values", async () => {
		const [event] = await chain(1);
		if (!event) throw new Error("no event");
		expect(event.commitments).toEqual({
			email: await sha256Hex(`${SALT}ada@example.com`),
			name: await sha256Hex(`${SALT}Ada Lovelace`),
		});
		expect(await commitPersonal(SALT, "Ada Lovelace")).toBe(event.commitments.name);
		// Same event, different raw personal value but the same commitments: same hash.
		const tampered = { ...event, personal: { name: "Someone Else", email: "x@example.com" } };
		expect((await verifyAuditChain(ENV, [tampered])).ok).toBe(true);
	});

	it("ES-FR-05 event ids are deterministic per (envelope, seq) and sort in seq order", () => {
		expect(auditEventId("e", 0)).toBe("e:a000000");
		expect(auditEventId("e", 12)).toBe("e:a000012");
		expect(auditEventId("e", 2) < auditEventId("e", 10)).toBe(true);
	});

	it("ES-FR-05 newPiiSalt returns 32 random bytes as hex, from the injected source", () => {
		expect(newPiiSalt(() => new Uint8Array(32).fill(255))).toBe("ff".repeat(32));
		expect(newPiiSalt()).toMatch(/^[0-9a-f]{64}$/);
		expect(newPiiSalt()).not.toBe(newPiiSalt());
	});
});

describe("ES-FR-05 verifier", () => {
	it("ES-FR-05 accepts an untouched chain and returns its head and length", async () => {
		const events = await chain(4);
		expect(await verifyAuditChain(ENV, events, { salt: SALT, head: events[3]?.hash })).toEqual({
			ok: true,
			value: { head: events[3]?.hash, length: 4 },
		});
	});

	it("ES-FR-05 an empty chain verifies to the genesis hash, unless a head is expected", async () => {
		expect(await verifyAuditChain(ENV, [])).toEqual({ ok: true, value: { head: AUDIT_GENESIS, length: 0 } });
		expect(await verifyAuditChain(ENV, [], { head: "f".repeat(64) })).toEqual({
			ok: false,
			error: { seq: 0, reason: "HEAD" },
		});
	});

	it("ES-FR-05 rejects any edited event", async () => {
		const edits: Array<[string, (e: AuditEventDoc) => AuditEventDoc]> = [
			["type", (e) => ({ ...e, type: "envelope.voided" })],
			["at", (e) => ({ ...e, at: "2027-01-01T00:00:00.000Z" })],
			["actor", (e) => ({ ...e, actor: "signer" })],
			["data", (e) => ({ ...e, data: { ...e.data, templateId: "tpl2" } })],
			["added data", (e) => ({ ...e, data: { ...e.data, extra: 1 } })],
			["commitment", (e) => ({ ...e, commitments: { ...e.commitments, name: "0".repeat(64) } })],
			["hash", (e) => ({ ...e, hash: "0".repeat(64) })],
		];
		for (const [what, edit] of edits) {
			const events = await chain(4);
			events[2] = edit(events[2] as AuditEventDoc);
			expect(await verifyAuditChain(ENV, events), what).toEqual({ ok: false, error: { seq: 2, reason: "HASH" } });
		}
	});

	it("ES-FR-05 rejects an edit even when the edited event's own hash is recomputed", async () => {
		const events = await chain(4);
		const [forged] = await initialAuditEvents(ENV, [input(1, { actor: "intruder" })], SALT);
		// Re-link the forged event in place of seq 1 with a valid own hash: seq 2 no longer links.
		const relinked = (await initialAuditEvents(ENV, [input(0), input(1, { actor: "intruder" })], SALT))[1]?.data;
		expect(forged).toBeDefined();
		events[1] = relinked as AuditEventDoc;
		expect(await verifyAuditChain(ENV, events)).toEqual({ ok: false, error: { seq: 2, reason: "PREV_HASH" } });
	});

	it("ES-FR-05 rejects a removed event (first, middle, or the tail against the recorded head)", async () => {
		const events = await chain(4);
		expect(await verifyAuditChain(ENV, events.slice(1))).toEqual({ ok: false, error: { seq: 0, reason: "SEQ" } });
		expect(await verifyAuditChain(ENV, [events[0], events[1], events[3]] as AuditEventDoc[])).toEqual({
			ok: false,
			error: { seq: 2, reason: "SEQ" },
		});
		expect(await verifyAuditChain(ENV, events.slice(0, 3), { head: events[3]?.hash })).toEqual({
			ok: false,
			error: { seq: 3, reason: "HEAD" },
		});
	});

	it("ES-FR-05 rejects reordered events", async () => {
		const events = await chain(4);
		const swapped = [events[0], events[2], events[1], events[3]] as AuditEventDoc[];
		expect(await verifyAuditChain(ENV, swapped)).toEqual({ ok: false, error: { seq: 1, reason: "SEQ" } });
		// Renumbering the swapped events to hide the reorder breaks their hashes.
		const renumbered = swapped.map((e, i) => ({ ...e, seq: i }));
		expect(await verifyAuditChain(ENV, renumbered)).toEqual({ ok: false, error: { seq: 1, reason: "HASH" } });
	});

	it("ES-FR-05 rejects an event moved from another envelope's chain", async () => {
		const events = await chain(2);
		expect(await verifyAuditChain("env2", events)).toEqual({ ok: false, error: { seq: 0, reason: "ENVELOPE" } });
	});

	it("ES-FR-05 a fully rewritten chain is caught only by the recorded head", async () => {
		const events = await chain(3);
		const rewritten = (await initialAuditEvents(ENV, [input(0), input(1, { actor: "intruder" }), input(2)], SALT)).map(
			(d) => d.data,
		);
		expect((await verifyAuditChain(ENV, rewritten)).ok).toBe(true);
		expect(await verifyAuditChain(ENV, rewritten, { head: events[2]?.hash })).toEqual({
			ok: false,
			error: { seq: 3, reason: "HEAD" },
		});
	});

	it("ES-FR-05 with the salt, a raw personal value that no longer matches its commitment is rejected", async () => {
		const events = await chain(2);
		const e = events[1] as AuditEventDoc;
		events[1] = { ...e, personal: { ...e.personal, email: "mallory@example.com" } };
		expect(await verifyAuditChain(ENV, events)).toMatchObject({ ok: true });
		expect(await verifyAuditChain(ENV, events, { salt: SALT })).toEqual({
			ok: false,
			error: { seq: 1, reason: "COMMITMENT" },
		});
		// A personal value with no commitment at all is rejected too.
		events[1] = { ...e, personal: { ...e.personal, ip: "203.0.113.9" } };
		expect(await verifyAuditChain(ENV, events, { salt: SALT })).toEqual({
			ok: false,
			error: { seq: 1, reason: "COMMITMENT" },
		});
	});

	it("ES-FR-05 events without personal fields carry no commitments and verify", async () => {
		const docs = await initialAuditEvents(ENV, [{ type: "envelope.sent", at: "2026-10-21T00:00:00.000Z", actor: "system" }], SALT);
		const event = docs[0]?.data as AuditEventDoc;
		expect(event.commitments).toEqual({});
		expect(event.data).toEqual({});
		expect(event.personal).toBeNull();
		expect((await verifyAuditChain(ENV, [event], { salt: SALT })).ok).toBe(true);
	});

	it("ES-FR-05 key order in stored documents does not change the hash", async () => {
		const [event] = await chain(1);
		const e = event as AuditEventDoc;
		const reversed = Object.fromEntries(Object.entries(e.data).reverse());
		const commitments = Object.fromEntries(Object.entries(e.commitments).reverse());
		expect((await verifyAuditChain(ENV, [{ ...e, data: reversed, commitments }])).ok).toBe(true);
	});
});

describe("ES-NFR-06 retention purge keeps the chain verifiable", () => {
	it("ES-NFR-06 deleting personal fields leaves the chain verifiable (with or without the salt)", async () => {
		const events = await chain(4);
		const head = events[3]?.hash;
		const purged = events.map(purgePersonal);
		expect(purged.every((e) => e.personal === null)).toBe(true);
		expect(JSON.stringify(purged)).not.toContain("ada@example.com");
		expect(JSON.stringify(purged)).not.toContain("Ada Lovelace");
		expect(await verifyAuditChain(ENV, purged, { head })).toEqual({ ok: true, value: { head, length: 4 } });
		expect(await verifyAuditChain(ENV, purged, { salt: SALT, head })).toEqual({ ok: true, value: { head, length: 4 } });
		// A value disclosed later (e.g. on the certificate) can still be proven against the commitment.
		expect(await commitPersonal(SALT, "ada@example.com")).toBe(purged[0]?.commitments.email);
	});

	it("ES-NFR-06 a partially purged chain (some events purged) still verifies", async () => {
		const events = await chain(3);
		const mixed = [purgePersonal(events[0] as AuditEventDoc), events[1], events[2]] as AuditEventDoc[];
		expect((await verifyAuditChain(ENV, mixed, { salt: SALT })).ok).toBe(true);
	});
});

describe("ES-FR-06 final envelope hash", () => {
	it("ES-FR-06 binds docSha256 to the chain head", async () => {
		const doc = "d".repeat(64);
		const head = "e".repeat(64);
		expect(await finalEnvelopeHash(doc, head)).toBe(await sha256Hex(`esign-final/1\n${doc}\n${head}`));
		expect(await finalEnvelopeHash(doc, head)).not.toBe(await finalEnvelopeHash(doc, "f".repeat(64)));
		expect(await finalEnvelopeHash(doc, head)).not.toBe(await finalEnvelopeHash("c".repeat(64), head));
	});
});

describe("ES-FR-05 concurrent appends never fork the chain (CAS)", () => {
	it("ES-FR-05 appends to an empty chain start at the genesis", async () => {
		const store = memoryStore();
		const r = await appendAuditEvent(store, ENV, input(0), { salt: SALT });
		expect(r).toMatchObject({ ok: true, value: { seq: 0, prevHash: AUDIT_GENESIS } });
		expect([...store.rows.keys()]).toEqual([auditEventId(ENV, 0)]);
	});

	it("ES-FR-05 appends after the stored head", async () => {
		const store = memoryStore();
		for (const d of await initialAuditEvents(ENV, [input(0), input(1)], SALT)) store.rows.set(d.id, d.data);
		const r = await appendAuditEvent(store, ENV, input(2), { salt: SALT });
		expect(r).toMatchObject({ ok: true, value: { seq: 2 } });
		expect(await verifyAuditChain(ENV, ordered(store), { salt: SALT })).toMatchObject({
			ok: true,
			value: { length: 3, head: r.ok ? r.value.hash : "" },
		});
	});

	it("ES-FR-05 twenty racing appends with retries all land on one linear chain", async () => {
		const store = memoryStore();
		const results = await Promise.all(
			Array.from({ length: 20 }, (_, n) => appendAuditEvent(store, ENV, input(n), { salt: SALT, attempts: 25 })),
		);
		expect(results.every((r) => r.ok)).toBe(true);
		const events = ordered(store);
		expect(events.map((e) => e.seq)).toEqual(Array.from({ length: 20 }, (_, i) => i));
		expect(new Set(events.map((e) => e.prevHash)).size).toBe(20);
		expect((await verifyAuditChain(ENV, events, { salt: SALT })).ok).toBe(true);
	});

	it("ES-FR-05 losers that run out of attempts report CONFLICT and never write a fork", async () => {
		const store = memoryStore();
		const results = await Promise.all(
			Array.from({ length: 5 }, (_, n) => appendAuditEvent(store, ENV, input(n), { salt: SALT, attempts: 1 })),
		);
		const won = results.filter((r) => r.ok);
		expect(won).toHaveLength(1);
		expect(results.filter((r) => !r.ok)).toEqual(Array.from({ length: 4 }, () => ({ ok: false, error: "CONFLICT" })));
		expect(ordered(store)).toHaveLength(1);
		expect((await verifyAuditChain(ENV, ordered(store))).ok).toBe(true);
	});

	it("ES-FR-05 defaults to two attempts: one retry after a lost race", async () => {
		const store = memoryStore();
		let calls = 0;
		const racing: AuditStore = {
			query: (o) => store.query(o),
			async compareAndSet(id, expected, data) {
				calls++;
				if (calls === 1) {
					// Another writer takes the slot between our read and our write.
					const [other] = await initialAuditEvents(ENV, [input(9)], SALT);
					if (other) store.rows.set(other.id, other.data);
				}
				return store.compareAndSet(id, expected, data);
			},
		};
		const r = await appendAuditEvent(racing, ENV, input(1), { salt: SALT });
		expect(r).toMatchObject({ ok: true, value: { seq: 1 } });
		expect(calls).toBe(2);
		expect((await verifyAuditChain(ENV, ordered(store))).ok).toBe(true);
	});
});
