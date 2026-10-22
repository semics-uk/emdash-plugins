import { decodeBase64Url, type ReceiptPayload, verifyReceiptToken } from "@semics-tech/shared";
import { describe, expect, it } from "vitest";
import VECTORS from "../../../docs/protocol/vectors.json";
import { type ReceiptSource, receiptPayload, signReceipt } from "../src/domain/receipts";

// T062 (ES-FR-14): e-sign is the receipt issuer (protocol §5.2). Every untampered receipt vector is
// reproduced byte for byte from the envelope state it describes; the schema-breaking ones are
// states the issuer refuses or never produces; and every vector still verifies as the spec says.

interface Vector {
	name: string;
	type: string;
	input: {
		token: string;
		signedWithPrefix?: string;
		signedWithSecret?: string;
		payload?: ReceiptPayload;
		tamper?: string;
	};
	verifier: { now: number; clients: Record<string, { secret: string; revoked: boolean }> };
	expected: { ok: true; payload: ReceiptPayload } | { ok: false; error: string };
}

const RECEIPTS = (VECTORS as unknown as { vectors: Vector[] }).vectors.filter((v) => v.type === "receipt");
const iso = (s: number) => new Date(s * 1000).toISOString();
const secretOf = (b64: string) => decodeBase64Url(b64) as Uint8Array;

/** The stored envelope a receipt payload describes. */
function envelopeFor(p: ReceiptPayload): ReceiptSource {
	return {
		status: p.status as ReceiptSource["status"],
		clientId: p.cid,
		externalRef: p.ref,
		docSha256: p.docSha256,
		pdfSha256: p.pdfSha256,
		finalHash: p.finalHash,
		completedAt: p.status === "completed" ? iso(p.at) : null,
		...(p.status === "completed" ? {} : { closedAt: iso(p.at) }),
		updatedAt: iso(p.at + 3600),
	};
}

const ISSUABLE = RECEIPTS.filter(
	(v) =>
		v.input.payload &&
		!v.input.tamper &&
		v.input.signedWithPrefix === "esign-receipt/1" &&
		v.name !== "receipt/oversize",
).filter((v) => v.expected.ok || v.expected.error === "TOKEN_NOT_YET_VALID");

describe("ES-FR-14 receipt vectors: e-sign issues them byte for byte", () => {
	it("the vector file has the 19 receipt vectors", () => {
		expect(RECEIPTS).toHaveLength(19);
		expect(ISSUABLE.map((v) => v.name)).toEqual(
			expect.arrayContaining([
				"receipt/valid-completed",
				"receipt/valid-declined",
				"receipt/valid-completed-pdf-pending",
			]),
		);
	});

	it.each(ISSUABLE.map((v) => [v.name, v] as const))("%s", async (_name, v) => {
		const p = v.input.payload as ReceiptPayload;
		const secret = secretOf(v.input.signedWithSecret as string);
		const envelope = envelopeFor(p);
		expect(receiptPayload(p.envelopeId, envelope)).toEqual(p);
		expect(await signReceipt(p.envelopeId, envelope, secret)).toBe(v.input.token);
		// Deterministic: the same state always yields the same token (§5.2).
		expect(await signReceipt(p.envelopeId, envelope, secret)).toBe(v.input.token);
	});

	it.each(RECEIPTS.map((v) => [v.name, v] as const))("verifies as the vector says: %s", async (_name, v) => {
		const clients = v.verifier.clients;
		const result = await verifyReceiptToken({
			token: v.input.token,
			now: v.verifier.now * 1000,
			getClient: (cid) => {
				const c = clients[cid];
				return c ? { secret: secretOf(c.secret), revoked: c.revoked } : undefined;
			},
		});
		if (v.expected.ok) expect(result).toEqual({ ok: true, value: v.expected.payload });
		else expect(result).toEqual({ ok: false, error: v.expected.error });
	});
});

describe("ES-FR-14 the issuer refuses or corrects the schema-breaking receipt states", () => {
	const valid = RECEIPTS.find((v) => v.name === "receipt/valid-completed")?.input.payload as ReceiptPayload;
	const secret = secretOf(RECEIPTS.find((v) => v.name === "receipt/valid-completed")?.input.signedWithSecret as string);

	it("receipt/uppercase-hex: a non-lowercase hash is never signed", async () => {
		const bad = { ...envelopeFor(valid), docSha256: valid.docSha256.toUpperCase() };
		expect(receiptPayload(valid.envelopeId, bad)).toBeUndefined();
		expect(await signReceipt(valid.envelopeId, bad, secret)).toBeUndefined();
	});

	it("receipt/completed-without-final-hash: a completed envelope without finalHash gets no receipt", async () => {
		expect(await signReceipt(valid.envelopeId, { ...envelopeFor(valid), finalHash: null }, secret)).toBeUndefined();
	});

	it("receipt/declined-with-pdf-hash: hashes are null for every non-completed status", () => {
		for (const status of ["declined", "voided", "expired"] as const) {
			const p = receiptPayload(valid.envelopeId, { ...envelopeFor(valid), status, closedAt: iso(valid.at) });
			expect(p, status).toMatchObject({ status, pdfSha256: null, finalHash: null, at: valid.at });
		}
	});

	it("receipt/unknown-status: only terminal statuses have receipts", () => {
		for (const status of ["draft", "sent", "in_progress"] as const) {
			expect(receiptPayload(valid.envelopeId, { ...envelopeFor(valid), status }), status).toBeUndefined();
		}
	});

	it("an envelope no integration created (no clientId or ref) has no receipt", () => {
		const { clientId: _c, ...noClient } = envelopeFor(valid);
		expect(receiptPayload(valid.envelopeId, noClient)).toBeUndefined();
		const { externalRef: _r, ...noRef } = envelopeFor(valid);
		expect(receiptPayload(valid.envelopeId, noRef)).toBeUndefined();
	});

	it("a pending PDF is null, and `at` falls back to updatedAt for a close written before T062", () => {
		const pending = receiptPayload(valid.envelopeId, { ...envelopeFor(valid), pdfSha256: undefined });
		expect(pending?.pdfSha256).toBeNull();
		const old: ReceiptSource = { ...envelopeFor(valid), status: "voided", closedAt: null };
		expect(receiptPayload(valid.envelopeId, old)?.at).toBe(valid.at + 3600);
	});
});
