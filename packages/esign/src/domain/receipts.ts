/**
 * Signed receipts (ES-FR-14, protocol §5.2): e-sign's answer to the integration that created an
 * envelope, once the envelope is terminal. Minted deterministically from the stored envelope (fixed
 * field order, values only from the document), so the same state always yields the same token; the
 * receipt carries hashes and ids, never personal data.
 *
 * `at` is when the envelope entered its status: `completedAt`, else `closedAt` (written by decline
 * and void since T062), else `updatedAt` for an envelope closed before `closedAt` existed.
 */
import { type ReceiptPayload, type ReceiptStatus, signEsignToken, validateEsignPayload } from "@semics-tech/shared";
import type { EnvelopeDoc } from "./envelopes";

export type ReceiptSource = Pick<EnvelopeDoc, "status" | "docSha256" | "finalHash" | "completedAt" | "updatedAt"> &
	Partial<Pick<EnvelopeDoc, "clientId" | "externalRef" | "pdfSha256" | "closedAt">>;

const RECEIPT_STATUSES: readonly string[] = ["completed", "declined", "voided", "expired"] satisfies ReceiptStatus[];

const seconds = (iso: string | null | undefined): number | undefined => {
	if (!iso) return undefined;
	const ms = Date.parse(iso);
	return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
};

/** The receipt payload for envelope `id`, or `undefined` when it has none (not terminal, not an integration's, or unsound). */
export function receiptPayload(id: string, envelope: ReceiptSource): ReceiptPayload | undefined {
	const { status, clientId, externalRef } = envelope;
	if (!RECEIPT_STATUSES.includes(status) || !clientId || !externalRef || envelope.docSha256 === null) return undefined;
	const completed = status === "completed";
	const at = completed ? seconds(envelope.completedAt) : (seconds(envelope.closedAt) ?? seconds(envelope.updatedAt));
	if (at === undefined) return undefined;
	const payload: ReceiptPayload = {
		v: 1,
		typ: "receipt",
		cid: clientId,
		envelopeId: id,
		ref: externalRef,
		status: status as ReceiptStatus,
		docSha256: envelope.docSha256,
		pdfSha256: completed ? (envelope.pdfSha256 ?? null) : null,
		finalHash: completed ? envelope.finalHash : null,
		at,
	};
	return validateEsignPayload("receipt", payload).ok ? payload : undefined;
}

/** The `esign-receipt/1` token for envelope `id` under the client's secret, or `undefined` when it has none. */
export async function signReceipt(
	id: string,
	envelope: ReceiptSource,
	secret: Uint8Array,
): Promise<string | undefined> {
	const payload = receiptPayload(id, envelope);
	return payload ? signEsignToken("receipt", payload, secret) : undefined;
}
