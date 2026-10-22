/**
 * The signed PDF (ES-FR-07, ES-FR-08). Pure: no I/O, no clock.
 *
 * Built once, when the envelope completes, from what is stored: the frozen snapshot text, the
 * signer's signature, and the audit chain. The bytes come from the shared deterministic writer
 * (`renderPdf`, T016), so the same envelope always renders the same bytes; `pdfSha256` is the
 * SHA-256 of those bytes and the download serves them unchanged.
 *
 * Layout: the document (the snapshot's parsed Markdown, then the signature block), then a certificate of
 * completion: the envelope facts, every audit event in order, the audit chain head and the
 * envelope's `finalHash` (T023). The certificate wording is owned here and never claims more than
 * a simple electronic signature.
 *
 * Storage: `artifacts/<envelopeId>:pdf:<sha256[0..16]>:<i>`, base64 in chunks of exactly
 * `ARTIFACT_CHUNK_CHARS` (256 KiB; the last may be shorter), so every document stays well under
 * the 512 KiB limit (R24). Hash-addressed ids mean a racing writer can only ever write the same
 * chunks again.
 */
import { type PdfBlock, type PdfDocument, renderPdf, sha256Hex } from "@semics-tech/shared";
// The ceremony's own parser (pure, no imports), so the PDF shows the document the way the page did.
import { parseSnapshot, type Block as SnapshotBlock, type Inline as SnapshotInline } from "../astro/lib/markdown";
import type { AuditEventDoc } from "./audit";
import type { EnvelopeDoc, SignerDoc } from "./envelopes";

/** Base64 characters per artifact chunk (256 KiB). */
export const ARTIFACT_CHUNK_CHARS = 256 * 1024;
/** Raw PDF bytes per chunk: 3 bytes per 4 base64 characters, so chunks need no padding. */
export const ARTIFACT_CHUNK_BYTES = (ARTIFACT_CHUNK_CHARS / 4) * 3;

export const SIGNED_PDF_KIND = "signed-pdf";

export interface ArtifactChunkDoc {
	envelopeId: string;
	kind: typeof SIGNED_PDF_KIND;
	contentType: "application/pdf";
	index: number;
	count: number;
	/** Length of the whole PDF in bytes. */
	bytes: number;
	/** SHA-256 of the whole PDF (the envelope's `pdfSha256`). */
	sha256: string;
	/** This chunk's bytes, base64. */
	data: string;
}

/** What the envelope records once the PDF is stored. */
export interface StoredPdf {
	ids: string[];
	bytes: number;
}

export interface SignedPdfInput {
	envelopeId: string;
	envelope: Pick<EnvelopeDoc, "title" | "docSha256" | "completedAt" | "finalHash" | "signerFields">;
	/** Every signer in signing order: one in Free, several in a Pro envelope (T090). */
	signers: ReadonlyArray<PdfSigner>;
	/** The frozen snapshot text (its SHA-256 is `docSha256`). */
	snapshot: string;
	/** The whole audit chain in seq order, already verified against `head`. */
	events: readonly AuditEventDoc[];
	head: string;
}

export type PdfSigner = Pick<
	SignerDoc,
	| "name"
	| "as"
	| "participant"
	| "signature"
	| "signedAt"
	| "consentVersion"
	| "consentSha256"
	| "fieldValues"
	| "otpVerifiedAt"
>;

export const CERTIFICATE_WORDING =
	"This certificate records how the document above was signed. It was signed with a simple " +
	"electronic signature: the signer consented to sign electronically, confirmed their intent to " +
	"sign, and signed the exact text identified by the document SHA-256 below. Every step is " +
	"recorded in a hash-chained audit trail; the final hash binds the document to the end of that " +
	"trail. Anyone holding this PDF can check these values on the verify page.";

const CAPACITY: Record<SignerDoc["as"], string> = { self: "Self", guardian: "Parent or guardian", buyer: "Buyer" };

/** `2026-10-21T10:00:00.000Z` → `2026-10-21 10:00:00 UTC`. */
const utc = (iso: string | null | undefined) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC` : "");

type Inline = SnapshotInline;

/** The visible text of inline nodes: emphasis and code as their text, a link as `text (href)`. */
function inlineText(nodes: readonly Inline[]): string {
	return nodes
		.map((n) => {
			switch (n.type) {
				case "text":
				case "code":
					return n.text;
				case "break":
					return "\n";
				case "link": {
					const label = inlineText(n.children);
					return label === n.href ? label : `${label} (${n.href})`;
				}
				default:
					return inlineText(n.children);
			}
		})
		.join("");
}

/**
 * The snapshot as PDF blocks, from the same parsed tree the ceremony renders (`parseSnapshot`, T117):
 * headings, paragraphs, list items (bullet or number), quotes (italic), code verbatim and rules. The
 * PDF writer has no inline styles, so emphasis shows as its plain text and a link as `text (href)`;
 * anything the parser leaves literal (an unsafe link, an image) stays literal, as on the page.
 */
function snapshotBlocks(text: string): PdfBlock[] {
	const out: PdfBlock[] = [];
	const walk = (tree: readonly SnapshotBlock[], quoted: boolean) => {
		for (const b of tree) {
			switch (b.type) {
				case "heading":
					out.push({ type: "heading", text: inlineText(b.children), level: Math.min(b.level, 3) as 2 | 3 });
					break;
				case "paragraph":
					out.push({ type: "paragraph", text: inlineText(b.children), ...(quoted ? { font: "italic" as const } : {}) });
					break;
				case "list":
					b.items.forEach((item, i) => {
						const marker = b.ordered ? `${(b.start ?? 1) + i}.` : "\u2022";
						out.push({
							type: "paragraph",
							text: `${marker} ${inlineText(item)}`,
							...(quoted ? { font: "italic" as const } : {}),
						});
					});
					break;
				case "quote":
					walk(b.children, true);
					break;
				case "code":
					out.push({ type: "paragraph", text: b.text, size: 9 });
					break;
				case "rule":
					out.push({ type: "rule" });
					break;
			}
		}
	};
	walk(parseSnapshot(text), false);
	return out;
}

function signatureBlock(signer: PdfSigner): PdfBlock {
	const signature = signer.signature;
	const caption = [signer.name, `Signed ${utc(signer.signedAt)}`];
	if (signature?.kind === "drawn" && signature.strokes) {
		return {
			type: "signature",
			label: "Signature",
			strokes: { v: 1, w: 1, h: 1, strokes: signature.strokes as Array<Array<[number, number]>> },
			caption: signature.typedName ? [signature.typedName, ...caption] : caption,
		};
	}
	return { type: "signature", label: "Signature", typedName: signature?.typedName ?? signer.name, caption };
}

/**
 * The values the signer entered (T033 signer fields), labelled, in the sender's order: part of the
 * signed document, and covered by the signature hash (`bindSignature`). None declared: no block.
 */
function entriesBlocks(input: SignedPdfInput, signer: PdfSigner, many: boolean): PdfBlock[] {
	const fields = input.envelope.signerFields ?? [];
	if (fields.length === 0) return [];
	const values = signer.fieldValues ?? {};
	return [
		{ type: "spacer", height: 12 },
		{ type: "heading", text: `Details entered by ${many ? signer.name : "the signer"}`, level: 2 },
		{
			type: "table",
			columns: [{ header: "Field" }, { header: "Value", width: 2 }],
			rows: fields.map((f) => [f.label, values[f.key] ?? ""]),
		},
	];
}

/** The PDF content (exposed for tests; `renderSignedPdf` renders it). */
export function signedPdfDocument(input: SignedPdfInput): PdfDocument {
	const { envelope, signers, events, head, envelopeId } = input;
	const many = signers.length > 1;
	// One group of facts per signer, in signing order ("Signer 2" when there are several, T090).
	const facts: string[][] = [
		["Envelope", envelopeId],
		["Document", envelope.title],
		["Document SHA-256", envelope.docSha256 ?? ""],
		...signers.flatMap((signer, i) => [
			[many ? `Signer ${i + 1}` : "Signer", signer.name],
			["Signing as", CAPACITY[signer.as] ?? signer.as],
			...(signer.participant ? [["Participant", signer.participant.name]] : []),
			["Signature", signer.signature?.kind === "drawn" ? "Drawn" : "Typed"],
			["Signature SHA-256", signer.signature?.sha256 ?? ""],
			["Consent version", signer.consentVersion ?? ""],
			...(signer.consentSha256 ? [["Consent wording SHA-256", signer.consentSha256]] : []),
			...(signer.otpVerifiedAt ? [["Identity check", "Email one-time code verified"]] : []),
			["Signed", utc(signer.signedAt)],
		]),
		["Completed", utc(envelope.completedAt)],
		["Audit events", String(events.length)],
	];
	const rows = events.map((e) => [
		String(e.seq + 1),
		utc(e.at),
		e.type,
		typeof e.data.signer === "number" ? `signer ${e.data.signer}` : e.actor,
		e.personal?.ip ?? "",
		e.hash.slice(0, 16),
	]);
	return {
		info: {
			title: envelope.title,
			subject: "Signed document and certificate of completion",
			creator: "semics e-sign",
			...(envelope.completedAt ? { creationDate: new Date(envelope.completedAt) } : {}),
		},
		footer: { text: `Envelope ${envelopeId}`, pageNumbers: true },
		blocks: [
			{ type: "heading", text: envelope.title, level: 1 },
			...snapshotBlocks(input.snapshot),
			...signers.flatMap((signer): PdfBlock[] => [
				...entriesBlocks(input, signer, many),
				{ type: "spacer", height: 18 },
				signatureBlock(signer),
			]),
			{ type: "pageBreak" },
			{ type: "heading", text: "Certificate of completion", level: 1 },
			{ type: "paragraph", text: CERTIFICATE_WORDING },
			{ type: "spacer", height: 8 },
			{ type: "table", columns: [{ header: "Field" }, { header: "Value", width: 3 }], rows: facts },
			{ type: "spacer", height: 8 },
			{ type: "heading", text: "Audit trail", level: 2 },
			{
				type: "table",
				columns: [
					{ header: "#", width: 0.4 },
					{ header: "Time", width: 1.6 },
					{ header: "Event", width: 1.6 },
					{ header: "Actor", width: 0.8 },
					{ header: "IP address", width: 1.2 },
					{ header: "Event hash (first 16)", width: 1.6 },
				],
				rows,
				size: 8,
			},
			{ type: "spacer", height: 8 },
			{ type: "paragraph", text: "Audit chain head", font: "bold", size: 9 },
			{ type: "paragraph", text: head, size: 9 },
			{ type: "paragraph", text: "Final hash", font: "bold", size: 9 },
			{ type: "paragraph", text: envelope.finalHash ?? "", size: 9 },
		],
	};
}

/** Renders the signed PDF and hashes the bytes. */
export async function renderSignedPdf(input: SignedPdfInput): Promise<{ bytes: Uint8Array; sha256: string }> {
	const bytes = renderPdf(signedPdfDocument(input));
	return { bytes, sha256: await sha256Hex(bytes) };
}

// --- chunked storage ---

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(binary);
}

function fromBase64(text: string): Uint8Array | null {
	try {
		const binary = atob(text);
		const out = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
		return out;
	} catch {
		return null;
	}
}

export const artifactChunkId = (envelopeId: string, sha256: string, index: number) =>
	`${envelopeId}:pdf:${sha256.slice(0, 16)}:${index}`;

/** Splits the PDF into hash-addressed base64 chunks (at least one). */
export function pdfChunks(
	envelopeId: string,
	bytes: Uint8Array,
	sha256: string,
): Array<{ id: string; data: ArtifactChunkDoc }> {
	const count = Math.max(1, Math.ceil(bytes.length / ARTIFACT_CHUNK_BYTES));
	return Array.from({ length: count }, (_, index) => ({
		id: artifactChunkId(envelopeId, sha256, index),
		data: {
			envelopeId,
			kind: SIGNED_PDF_KIND,
			contentType: "application/pdf",
			index,
			count,
			bytes: bytes.length,
			sha256,
			data: toBase64(bytes.subarray(index * ARTIFACT_CHUNK_BYTES, (index + 1) * ARTIFACT_CHUNK_BYTES)),
		},
	}));
}

/**
 * Reassembles chunks given in any order. `null` when one is missing or duplicated, when they
 * disagree about the PDF they belong to, or when the data is not valid base64 of the right length.
 * The caller still checks the SHA-256 of the result against `pdfSha256`.
 */
export function joinPdf(chunks: readonly ArtifactChunkDoc[]): Uint8Array | null {
	const first = chunks[0];
	if (!first || chunks.length !== first.count) return null;
	const ordered = [...chunks].sort((a, b) => a.index - b.index);
	const out = new Uint8Array(first.bytes);
	let offset = 0;
	for (const [i, chunk] of ordered.entries()) {
		if (chunk.index !== i || chunk.sha256 !== first.sha256 || chunk.bytes !== first.bytes) return null;
		const part = fromBase64(chunk.data);
		if (!part || offset + part.length > out.length) return null;
		out.set(part, offset);
		offset += part.length;
	}
	return offset === out.length ? out : null;
}
