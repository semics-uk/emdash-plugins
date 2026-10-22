import { sha256Hex } from "@semics-tech/shared";
import { describe, expect, it } from "vitest";
import { type AuditEventDoc, type AuditInput, finalEnvelopeHash, initialAuditEvents } from "../src/domain/audit";
import type { EnvelopeDoc, SignerDoc } from "../src/domain/envelopes";
import { MAX_DOCUMENT_BYTES } from "../src/domain/envelopes";
import {
	ARTIFACT_CHUNK_CHARS,
	type ArtifactChunkDoc,
	CERTIFICATE_WORDING,
	joinPdf,
	pdfChunks,
	renderSignedPdf,
	type SignedPdfInput,
	signedPdfDocument,
} from "../src/domain/pdf";

const ENV = "env1";
const SALT = "ab".repeat(32);
const DOC = "d".repeat(64);
const AT = "2026-10-21T10:00:00.000Z";

const inputs: AuditInput[] = [
	{ type: "envelope.created", at: AT, actor: "admin", data: { templateId: "t1" } },
	{ type: "envelope.sent", at: AT, actor: "admin", data: { docSha256: DOC } },
	{ type: "signer.viewed", at: AT, actor: "signer", data: { docSha256: DOC }, personal: { ip: "203.0.113.9" } },
	{ type: "signer.consented", at: AT, actor: "signer", data: { docSha256: DOC, consentVersion: "1", intent: true } },
	{ type: "signer.signed", at: AT, actor: "signer", data: { docSha256: DOC, kind: "drawn" } },
	{ type: "envelope.completed", at: AT, actor: "system", data: { docSha256: DOC } },
];

async function fixture(over: Partial<SignerDoc> = {}): Promise<SignedPdfInput> {
	const events: AuditEventDoc[] = (await initialAuditEvents(ENV, inputs, SALT)).map((e) => e.data);
	const head = events.at(-1)?.hash ?? "";
	const envelope = {
		title: "Waiver",
		docSha256: DOC,
		completedAt: AT,
		finalHash: await finalEnvelopeHash(DOC, head),
	} as EnvelopeDoc;
	const signer = {
		name: "Ada Lovelace",
		as: "self",
		status: "signed",
		signedAt: AT,
		consentVersion: "1",
		signature: {
			kind: "drawn",
			strokes: [
				[
					[0.1, 0.2],
					[0.5, 0.8],
				],
			],
			typedName: "Ada L",
			sha256: "e".repeat(64),
		},
		...over,
	} as SignerDoc;
	return { envelopeId: ENV, envelope, signers: [signer], snapshot: "# Terms\n\nI, Ada Lovelace, accept.\n", events, head };
}

const latin1 = (bytes: Uint8Array) => Array.from(bytes, (b) => String.fromCharCode(b)).join("");

describe("ES-FR-07 signed PDF and certificate", () => {
	it("ES-FR-07 the certificate lists every audit event, the audit head and the final hash", async () => {
		const input = await fixture();
		const { bytes, sha256 } = await renderSignedPdf(input);
		expect(sha256).toBe(await sha256Hex(bytes));
		const text = latin1(bytes);
		expect(text.startsWith("%PDF-")).toBe(true);
		for (const event of input.events) {
			expect(text).toContain(event.type);
			expect(text).toContain(event.hash.slice(0, 16));
		}
		expect(text).toContain(input.head);
		expect(text).toContain(input.envelope.finalHash as string);
		expect(text).toContain(DOC);
		expect(text).toContain("e".repeat(64));
		expect(text).toContain("Certificate of completion");
		expect(CERTIFICATE_WORDING).toContain("simple electronic signature");
		expect(signedPdfDocument(input).blocks).toContainEqual({ type: "paragraph", text: CERTIFICATE_WORDING });
		expect(text).not.toMatch(/qualified|advanced/i);
	});

	it("T034 the document shows the values the signer entered, labelled and in the sender's order", async () => {
		const input = await fixture({ fieldValues: { nickname: "Countess", phone: "0123 456" } });
		input.envelope.signerFields = [
			{ key: "phone", label: "Phone number", required: true },
			{ key: "nickname", label: "Nickname" },
			{ key: "unused", label: "Left blank" },
		];
		const doc = signedPdfDocument(input);
		const entries = doc.blocks.find((b) => b.type === "table" && JSON.stringify(b).includes("Phone number"));
		expect(entries).toMatchObject({
			rows: [
				["Phone number", "0123 456"],
				["Nickname", "Countess"],
				["Left blank", ""],
			],
		});
		// The entries belong to the signed document: before the signature, not only in the certificate.
		const at = (pred: (b: (typeof doc.blocks)[number]) => boolean) => doc.blocks.findIndex(pred);
		expect(at((b) => b === entries)).toBeLessThan(at((b) => b.type === "signature"));
		expect(latin1((await renderSignedPdf(input)).bytes)).toContain("0123 456");
		// No declared fields: no entries table.
		const plain = signedPdfDocument(await fixture());
		expect(plain.blocks.some((b) => b.type === "table" && JSON.stringify(b).includes("Phone number"))).toBe(false);
	});

	it("ES-FR-07 rendering is deterministic: the same envelope gives the same bytes", async () => {
		const a = await renderSignedPdf(await fixture());
		const b = await renderSignedPdf(await fixture());
		expect(a.sha256).toBe(b.sha256);
	});

	it("ES-FR-07 a drawn signature is drawn as strokes, a typed one is set as text", () => {
		return Promise.all([
			fixture().then((input) => {
				const sig = signedPdfDocument(input).blocks.find((b) => b.type === "signature");
				expect(sig).toMatchObject({
					strokes: {
						v: 1,
						w: 1,
						h: 1,
						strokes: [
							[
								[0.1, 0.2],
								[0.5, 0.8],
							],
						],
					},
				});
				expect(sig).not.toHaveProperty("typedName");
			}),
			fixture({ signature: { kind: "typed", typedName: "Ada Lovelace", sha256: "f".repeat(64) } }).then((input) => {
				const sig = signedPdfDocument(input).blocks.find((b) => b.type === "signature");
				expect(sig).toMatchObject({ typedName: "Ada Lovelace" });
				expect(sig).not.toHaveProperty("strokes");
			}),
		]);
	});

	it("ES-FR-15 several signers: each one's signature, entries and certificate facts, in signing order", async () => {
		const one = await fixture({ fieldValues: { phone: "111" } });
		const second = {
			...(one.signers[0] as SignerDoc),
			name: "Grace Hopper",
			as: "buyer",
			signedAt: "2026-10-22T09:00:00.000Z",
			fieldValues: { phone: "222" },
			signature: { kind: "typed", typedName: "Grace Hopper", sha256: "2".repeat(64) },
		} as SignerDoc;
		const input: SignedPdfInput = { ...one, signers: [...one.signers, second] };
		input.envelope.signerFields = [{ key: "phone", label: "Phone" }];
		const doc = signedPdfDocument(input);
		expect(doc.blocks.filter((b) => b.type === "signature")).toHaveLength(2);
		const facts = doc.blocks.find((b) => b.type === "table" && JSON.stringify(b).includes("Signature SHA-256"));
		const rows = (facts as { rows: string[][] }).rows;
		expect(rows).toContainEqual(["Signer 1", "Ada Lovelace"]);
		expect(rows).toContainEqual(["Signer 2", "Grace Hopper"]);
		expect(rows).toContainEqual(["Signature SHA-256", "2".repeat(64)]);
		expect(rows).toContainEqual(["Signing as", "Buyer"]);
		expect(rows.findIndex((r) => r[0] === "Signer 1")).toBeLessThan(rows.findIndex((r) => r[0] === "Signer 2"));
		const text = latin1((await renderSignedPdf(input)).bytes);
		for (const value of ["Details entered by Grace Hopper", "111", "222", "2026-10-22 09:00:00 UTC"]) {
			expect(text).toContain(value);
		}
		// One signer keeps the single-signer layout exactly.
		const single = signedPdfDocument(await fixture());
		const singleFacts = single.blocks.find((b) => b.type === "table" && JSON.stringify(b).includes("Signature SHA-256"));
		expect((singleFacts as { rows: string[][] }).rows).toContainEqual(["Signer", "Ada Lovelace"]);
	});

	it("ES-FR-15 the audit trail names the signer of each several-signer event", async () => {
		const input = await fixture();
		const [first, ...rest] = input.events as AuditEventDoc[];
		const events = [{ ...(first as AuditEventDoc), actor: "signer", data: { signer: 2 } }, ...rest];
		const trail = signedPdfDocument({ ...input, events }).blocks.filter((b) => b.type === "table").at(-1);
		expect((trail as { rows: string[][] }).rows[0]?.[3]).toBe("signer 2");
		expect((trail as { rows: string[][] }).rows[1]?.[3]).toBe("admin");
	});

	it("ES-FR-07 headings in the snapshot become PDF headings", async () => {
		const doc = signedPdfDocument({ ...(await fixture()), snapshot: "# A\n## B\n### C\n#### D\n\nText\nmore\n" });
		const headings = doc.blocks.filter((b) => b.type === "heading").map((b) => b.type === "heading" && b.text);
		expect(headings).toEqual(expect.arrayContaining(["A", "B", "C", "D"]));
		expect(doc.blocks).toContainEqual({ type: "paragraph", text: "Text\nmore" });
	});
});

describe("ES-FR-08 chunked storage of the signed PDF", () => {
	const big = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + (i >> 8)) & 0xff);

	it("ES-FR-08 large PDFs round-trip through 256 KiB base64 chunks, each document within 512 KiB", async () => {
		const bytes = big(700 * 1024 + 5);
		const sha256 = await sha256Hex(bytes);
		const chunks = pdfChunks(ENV, bytes, sha256);
		expect(chunks.length).toBe(4);
		for (const c of chunks) {
			expect(c.data.data.length).toBeLessThanOrEqual(ARTIFACT_CHUNK_CHARS);
			expect(JSON.stringify(c.data).length).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
			expect(c.data).toMatchObject({ envelopeId: ENV, kind: "signed-pdf", count: 4, sha256 });
			expect(c.id.startsWith(`${ENV}:pdf:${sha256.slice(0, 16)}:`)).toBe(true);
		}
		expect(chunks[0]?.data.data.length).toBe(ARTIFACT_CHUNK_CHARS);
		const shuffled = [...chunks].reverse().map((c) => c.data);
		const back = joinPdf(shuffled);
		expect(back && (await sha256Hex(back))).toBe(sha256);
		expect(back?.length).toBe(bytes.length);
	});

	it("ES-FR-08 an empty or tiny PDF is one chunk", async () => {
		const chunks = pdfChunks(ENV, new Uint8Array([1, 2, 3]), "a".repeat(64));
		expect(chunks).toHaveLength(1);
		expect(joinPdf(chunks.map((c) => c.data))).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("ES-FR-08 a missing, duplicated or mismatched chunk does not join", async () => {
		const bytes = big(300 * 1024);
		const chunks = pdfChunks(ENV, bytes, await sha256Hex(bytes)).map((c) => c.data);
		expect(joinPdf([])).toBeNull();
		expect(joinPdf(chunks.slice(1))).toBeNull();
		expect(joinPdf([chunks[0] as ArtifactChunkDoc, chunks[0] as ArtifactChunkDoc])).toBeNull();
		expect(joinPdf([chunks[0] as ArtifactChunkDoc, { ...(chunks[1] as ArtifactChunkDoc), sha256: "x" }])).toBeNull();
		expect(joinPdf([chunks[0] as ArtifactChunkDoc, { ...(chunks[1] as ArtifactChunkDoc), data: "%%%" }])).toBeNull();
	});

	it("T117 ES-FR-07 the document is rendered from the parsed Markdown tree, as the ceremony shows it", async () => {
		const snapshot = [
			"# Terms",
			"",
			"I, **Ada Lovelace**, accept the *gig* terms and `rule 7`.",
			"",
			"- Arrive by 7pm",
			"- Bring \\*ID\\*",
			"",
			"3. Third",
			"4. Fourth",
			"",
			"> Quoted _note_",
			"",
			"See [the venue page](https://venue.example/info) or [bad](javascript:alert(1)).",
			"",
			"---",
			"",
			"```",
			"**not bold**",
			"```",
			"",
		].join("\n");
		const doc = signedPdfDocument({ ...(await fixture()), snapshot });
		const texts = doc.blocks.flatMap((b) => (b.type === "paragraph" || b.type === "heading" ? [b.text] : []));
		expect(texts).toContain("Terms");
		expect(texts).toContain("I, Ada Lovelace, accept the gig terms and rule 7.");
		expect(texts).toContain("\u2022 Arrive by 7pm");
		expect(texts).toContain("\u2022 Bring *ID*");
		expect(texts).toContain("3. Third");
		expect(texts).toContain("4. Fourth");
		expect(texts).toContain("Quoted note");
		expect(texts).toContain("See the venue page (https://venue.example/info) or [bad](javascript:alert(1)).");
		// Code is shown verbatim, as in the ceremony.
		expect(texts).toContain("**not bold**");
		expect(doc.blocks).toContainEqual({ type: "rule" });
		const prose = texts.filter((t) => t !== "**not bold**").join("\n");
		expect(prose).not.toMatch(/\*\*|^#|^- /m);
		// Still deterministic.
		const a = await renderSignedPdf({ ...(await fixture()), snapshot });
		const b = await renderSignedPdf({ ...(await fixture()), snapshot });
		expect(a.sha256).toBe(b.sha256);
	});
});
