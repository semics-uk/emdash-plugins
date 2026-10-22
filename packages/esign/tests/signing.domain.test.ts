import { sha256Hex } from "@semics-tech/shared";
import { describe, expect, it } from "vitest";
import {
	AUDIT_GENESIS,
	type AuditBatchStore,
	type AuditEventDoc,
	extendAuditChain,
	initialAuditEvents,
	readAuditHead,
	verifyAuditChain,
	writeAuditEvents,
} from "../src/domain/audit";
import {
	bindSignature,
	cleanReason,
	declinedAuditEvents,
	parseSubmit,
	signedAuditEvents,
	viewedAuditEvent,
} from "../src/domain/signing";

const SHA = "a".repeat(64);
const OPTS = { fieldValues: {}, salt: "ab".repeat(32) };
const CONSENT_SHA = "c".repeat(64);
const base = {
	consent: true,
	intent: true,
	docSha256: SHA,
	consentSha256: CONSENT_SHA,
	signature: { kind: "typed", typedName: "Ada" },
};
const codes = (input: unknown) => {
	const r = parseSubmit(input);
	return r.ok ? [] : r.error.map((i) => i.code);
};
const dot = [
	[0, 0],
	[1, 1],
];

describe("ES-FR-04 parseSubmit", () => {
	it("accepts typed, drawn and both", () => {
		expect(parseSubmit(base)).toMatchObject({ ok: true, value: { fieldValues: {} } });
		const drawn = { ...base, signature: { kind: "drawn", strokes: [dot] } };
		expect(parseSubmit(drawn)).toMatchObject({ ok: true });
		expect(parseSubmit({ ...drawn, signature: { ...drawn.signature, typedName: " Ada " } })).toMatchObject({
			ok: true,
			value: { signature: { typedName: "Ada" } },
		});
		expect(parseSubmit({ ...base, fieldValues: { a: "b" } })).toMatchObject({ value: { fieldValues: { a: "b" } } });
	});

	it("reports every problem", () => {
		expect(codes(null)).toEqual(["INVALID_INPUT"]);
		expect(codes({})).toEqual([
			"CONSENT_REQUIRED",
			"INTENT_REQUIRED",
			"INVALID_DOC_HASH",
			"INVALID_CONSENT_HASH",
			"INVALID_SIGNATURE",
		]);
		expect(codes({ ...base, consent: "true" })).toEqual(["CONSENT_REQUIRED"]);
		expect(codes({ ...base, docSha256: "ABC" })).toEqual(["INVALID_DOC_HASH"]);
		expect(codes({ ...base, consentSha256: undefined })).toEqual(["INVALID_CONSENT_HASH"]);
		expect(codes({ ...base, consentSha256: "C".repeat(64) })).toEqual(["INVALID_CONSENT_HASH"]);
		expect(parseSubmit(base)).toMatchObject({ ok: true, value: { consentSha256: CONSENT_SHA } });
	});

	it("T117 ES-FR-04 rejects stroke points outside 0-1 (the pad normalises to 0-1)", () => {
		const sig = (strokes: unknown) => codes({ ...base, signature: { kind: "drawn", strokes } });
		expect(
			sig([
				[
					[0, 0],
					[1, 1],
					[0.5, 0.25],
				],
			]),
		).toEqual([]);
		for (const point of [
			[-0.01, 0.5],
			[0.5, 1.01],
			[2, 2],
			[0, -1],
		]) {
			expect(sig([[[0.1, 0.1], point]]), JSON.stringify(point)).toEqual(["INVALID_SIGNATURE"]);
		}
	});

	it("validates signatures and fields", () => {
		const sig = (signature: unknown) => codes({ ...base, signature });
		expect(sig({ kind: "typed" })).toEqual(["INVALID_SIGNATURE"]);
		expect(sig({ kind: "typed", typedName: "a\nb" })).toEqual(["INVALID_SIGNATURE"]);
		expect(sig({ kind: "typed", typedName: 5 })).toEqual(["INVALID_SIGNATURE"]);
		expect(sig({ kind: "pen" })).toEqual(["INVALID_SIGNATURE"]);
		expect(sig({ kind: "drawn" })).toEqual(["INVALID_SIGNATURE"]);
		expect(sig({ kind: "drawn", strokes: [] })).toEqual(["INVALID_SIGNATURE"]);
		expect(sig({ kind: "drawn", strokes: [[]] })).toEqual(["INVALID_SIGNATURE"]);
		expect(sig({ kind: "drawn", strokes: [[[0, "x"]]] })).toEqual(["INVALID_SIGNATURE"]);
		expect(sig({ kind: "drawn", strokes: [[[0, Number.NaN]]] })).toEqual(["INVALID_SIGNATURE"]);
		expect(sig({ kind: "drawn", strokes: Array.from({ length: 65 }, () => [[0, 0]]) })).toEqual(["INVALID_SIGNATURE"]);
		const huge = Array.from({ length: 3000 }, () => [0.123456789, 0.123456789]);
		expect(sig({ kind: "drawn", strokes: [huge] })).toEqual(["STROKES_TOO_LARGE"]);
		const f = (fieldValues: unknown) => codes({ ...base, fieldValues });
		expect(f("x")).toEqual(["INVALID_FIELDS"]);
		expect(f({ "bad key": "x" })).toEqual(["INVALID_FIELDS"]);
		expect(f({ a: 1 })).toEqual(["INVALID_FIELDS"]);
		expect(f({ a: "x".repeat(501) })).toEqual(["INVALID_FIELDS"]);
		expect(f(Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, "v"])))).toEqual(["INVALID_FIELDS"]);
	});

	it("cleans the decline reason", () => {
		expect(cleanReason(undefined)).toBeUndefined();
		expect(cleanReason("  no  ")).toBe("no");
		expect(cleanReason(" ")).toBeNull();
		expect(cleanReason(4)).toBeNull();
		expect(cleanReason("x".repeat(501))).toBeNull();
	});
});

describe("ES-FR-04 signature binding and audit inputs", () => {
	it("binds the signature to the document hash", async () => {
		const a = await bindSignature(SHA, { kind: "typed", typedName: "Ada" }, OPTS);
		const b = await bindSignature("b".repeat(64), { kind: "typed", typedName: "Ada" }, OPTS);
		expect(a.sha256).toMatch(/^[0-9a-f]{64}$/);
		expect(a.sha256).not.toBe(b.sha256);
	});

	it("T034 binds the values the signer entered, and salts the hash so a purged name cannot be guessed (R28)", async () => {
		const typed = { kind: "typed", typedName: "Ada" } as const;
		const salt = "ab".repeat(32);
		const plain = await bindSignature(SHA, typed, { fieldValues: { phone: "0123" }, salt });
		const other = await bindSignature(SHA, typed, { fieldValues: { phone: "0999" }, salt });
		const none = await bindSignature(SHA, typed, { fieldValues: {}, salt });
		const resalted = await bindSignature(SHA, typed, { fieldValues: { phone: "0123" }, salt: "cd".repeat(32) });
		expect(new Set([plain.sha256, other.sha256, none.sha256, resalted.sha256]).size).toBe(4);
		// Key order does not matter: the values are hashed in key order.
		const ab = await bindSignature(SHA, typed, { fieldValues: { a: "1", b: "2" }, salt });
		const ba = await bindSignature(SHA, typed, { fieldValues: { b: "2", a: "1" }, salt });
		expect(ab.sha256).toBe(ba.sha256);
		// Unsalted, a typed name could be confirmed from signatureSha256 alone after the retention purge.
		const unsalted = await sha256Hex(JSON.stringify([SHA, "typed", "Ada", null, []]));
		expect(none.sha256).not.toBe(unsalted);
	});

	it("builds the view, signed and declined events with request data only as personal fields", async () => {
		const who = { ip: "203.0.113.9", ua: "UA" };
		const signature = await bindSignature(SHA, { kind: "drawn", strokes: [dot] }, OPTS);
		const args = { at: "t", docSha256: SHA, consentVersion: "1", consentSha256: CONSENT_SHA, signerName: "Ada" };
		const signed = signedAuditEvents({ ...args, signature, who });
		expect(signed.map((e) => e.type)).toEqual(["signer.consented", "signer.signed", "envelope.completed"]);
		expect(signed[1]?.personal).toEqual({ name: "Ada", ...who });
		// T117: the consent event records the hash of the wording that was shown, not only its version.
		expect(signed[0]?.data).toEqual({ docSha256: SHA, consentVersion: "1", consentSha256: CONSENT_SHA, intent: true });
		expect(signed[2]?.personal).toBeUndefined();
		const typed = await bindSignature(SHA, { kind: "typed", typedName: "A. Lovelace" }, OPTS);
		expect(signedAuditEvents({ ...args, signature: typed, who: {} })[1]?.personal).toEqual({ name: "A. Lovelace" });
		expect(viewedAuditEvent("t", SHA, {}).personal).toEqual({});
		const declined = declinedAuditEvents({ at: "t", docSha256: null, hasReason: true, who });
		expect(declined.map((e) => e.type)).toEqual(["signer.declined", "envelope.declined"]);
		expect(JSON.stringify([...signed, ...declined].map((e) => e.data))).not.toContain("203.0.113.9");
	});
});

describe("ES-FR-05 batch audit writes", () => {
	const input = (n: number) => ({ type: "signer.viewed" as const, at: `t${n}`, actor: "signer" });

	function store(existing: AuditEventDoc[] = []) {
		const rows = new Map(existing.map((e) => [`${e.envelopeId}:${e.seq}`, e]));
		const calls: string[] = [];
		const s: AuditBatchStore = {
			query: async () => ({
				items: [...rows.values()]
					.sort((a, b) => b.seq - a.seq)
					.slice(0, 1)
					.map((data) => ({ id: String(data.seq), data })),
			}),
			compareAndSet: async (id, _r, data) => {
				calls.push("cas");
				if (rows.has(id)) return { applied: false };
				rows.set(id, data);
				return { applied: true };
			},
			putMany: async (items) => {
				calls.push("putMany");
				for (const i of items) rows.set(i.id, i.data);
			},
		};
		return { s, rows, calls };
	}

	it("extends a chain from the genesis or from a head, and writes it in two calls", async () => {
		const first = await initialAuditEvents("e", [input(0)], "salt");
		const { s, rows, calls } = store([first[0]?.data as AuditEventDoc]);
		const head = await readAuditHead(s, "e");
		expect(head?.seq).toBe(0);
		const next = await extendAuditChain("e", head, [input(1), input(2)], "salt");
		expect(next.map((n) => n.data.seq)).toEqual([1, 2]);
		expect(await writeAuditEvents(s, next)).toBe(true);
		expect(calls).toEqual(["cas", "putMany"]);
		const chain = [...rows.values()].sort((a, b) => a.seq - b.seq);
		expect(await verifyAuditChain("e", chain, { salt: "salt" })).toMatchObject({ ok: true, value: { length: 3 } });
		expect((await extendAuditChain("e", null, [input(0)], "salt"))[0]?.data.prevHash).toBe(AUDIT_GENESIS);
	});

	it("reports a lost race without writing the rest, and accepts an empty batch", async () => {
		const opening = await initialAuditEvents("e", [input(0)], "salt");
		const { s, calls } = store();
		const prev = opening[0]?.data ?? null;
		const racer = await extendAuditChain("e", prev, [input(1)], "salt");
		await s.compareAndSet(racer[0]?.id as string, null, racer[0]?.data as AuditEventDoc);
		const mine = await extendAuditChain("e", prev, [input(5), input(6)], "salt");
		expect(await writeAuditEvents(s, mine)).toBe(false);
		expect(calls).toEqual(["cas", "cas"]);
		expect(await writeAuditEvents(s, [])).toBe(true);
	});

	it("reads no head from an empty chain", async () => {
		expect(await readAuditHead(store().s, "e")).toBeNull();
	});
});
