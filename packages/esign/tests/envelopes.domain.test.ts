import { canonicalSnapshot, type IntentPayload, renderTemplate, sha256Hex } from "@semics-tech/shared";
import { describe, expect, it } from "vitest";
import {
	buildDraft,
	draftFromIntent,
	type EnvelopeDoc,
	joinSnapshot,
	MAX_DOCUMENT_BYTES,
	parseDraftInput,
	pickTemplateVersion,
	renderSnapshot,
	SNAPSHOT_CHUNK_CHARS,
	sendEnvelope,
	signerDocId,
	snapshotChunks,
} from "../src/domain/envelopes";
import type { TemplateDoc } from "../src/domain/templates";

const NOW = "2026-10-21T10:00:00.000Z";
const LATER = "2026-10-21T11:00:00.000Z";
const HASH = "a".repeat(64);

function template(over: Partial<TemplateDoc> = {}): TemplateDoc {
	return {
		name: "Waiver",
		kind: "text",
		status: "active",
		public: false,
		version: 2,
		body: "I, {{signer.name}}, accept the {{event}} terms.\r\n\r\nSigned  \n\n\n",
		fields: ["signer.name", "event"],
		createdAt: NOW,
		updatedAt: NOW,
		...over,
	};
}

const input = {
	templateId: "tpl1",
	signer: { name: " Ada Lovelace ", email: " Ada@Example.COM " },
	fields: { event: "Rock & <Roll>" },
};

function draft(): EnvelopeDoc {
	const fields = parseDraftInput(input);
	if (!fields.ok) throw new Error("bad fixture");
	const d = buildDraft(fields.value, template(), { now: NOW });
	if (!d.ok) throw new Error("bad fixture");
	return d.value;
}

async function send(env: EnvelopeDoc, tpl = template()) {
	return sendEnvelope("env1", env, tpl, { now: LATER, tokenHash: HASH, expiryDays: 30 });
}

describe("ES-FR-02 draft input", () => {
	it("ES-FR-02 normalises signer and keeps field values", () => {
		const r = parseDraftInput(input);
		expect(r).toEqual({
			ok: true,
			value: {
				templateId: "tpl1",
				signer: { name: "Ada Lovelace", email: "ada@example.com", as: "self" },
				fieldValues: { event: "Rock & <Roll>" },
			},
		});
	});

	it("ES-FR-02 rejects bad input with field issues", () => {
		expect(parseDraftInput(null)).toEqual({ ok: false, error: [{ path: "", code: "INVALID_INPUT" }] });
		const r = parseDraftInput({
			templateId: "a:v1",
			templateVersion: 0,
			title: "x".repeat(201),
			signer: { name: "", email: "nope" },
			fields: { "bad key": "v" },
		});
		expect(r.ok ? [] : r.error.map((i) => i.code).sort()).toEqual(
			[
				"INVALID_FIELDS",
				"INVALID_SIGNER_EMAIL",
				"INVALID_SIGNER_NAME",
				"INVALID_TEMPLATE_ID",
				"INVALID_TITLE",
				"INVALID_VERSION",
			].sort(),
		);
		const tooMany = Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`f${i}`, "v"]));
		expect(parseDraftInput({ ...input, fields: tooMany }).ok).toBe(false);
		expect(parseDraftInput({ ...input, fields: { a: "x".repeat(501) } }).ok).toBe(false);
		expect(parseDraftInput({ ...input, fields: { a: 1 } }).ok).toBe(false);
		expect(parseDraftInput({ ...input, signer: "ada" }).ok).toBe(false);
	});

	it("ES-FR-02 a draft whose fields cannot all be filled is rejected", () => {
		const fields = parseDraftInput({ ...input, fields: {} });
		if (!fields.ok) throw new Error("bad fixture");
		expect(buildDraft(fields.value, template(), { now: NOW })).toEqual({
			ok: false,
			error: [{ path: "fields.event", code: "MISSING_FIELD" }],
		});
	});

	it("ES-FR-02 the draft pins the template version and starts in draft", () => {
		const d = draft();
		expect(d).toMatchObject({
			status: "draft",
			templateId: "tpl1",
			templateVersion: 2,
			title: "Waiver",
			docSha256: null,
			snapshot: null,
		});
	});
});

describe("ES-FR-02 template version selection", () => {
	it("uses the head for the current version and the version doc when asked", () => {
		const head = template();
		const v1 = template({ status: "version", version: 1, body: "old" });
		expect(pickTemplateVersion(head, undefined, undefined)).toEqual({ ok: true, value: head });
		expect(pickTemplateVersion(head, v1, 1)).toEqual({ ok: true, value: v1 });
	});

	it("archived, missing, or a version-document head look missing", () => {
		const nf = { ok: false, error: "TEMPLATE_NOT_FOUND" };
		expect(pickTemplateVersion(undefined, undefined, undefined)).toEqual(nf);
		expect(pickTemplateVersion(template({ status: "archived" }), undefined, undefined)).toEqual(nf);
		expect(pickTemplateVersion(template({ status: "version" }), undefined, undefined)).toEqual(nf);
		expect(pickTemplateVersion(template(), undefined, 1)).toEqual(nf);
		expect(pickTemplateVersion(template(), template({ status: "version", version: 3 }), 1)).toEqual(nf);
	});
});

describe("ES-FR-02 snapshot and docSha256", () => {
	it("ES-FR-02 docSha256 = sha256Hex(canonicalSnapshot(renderTemplate output)); the stored text is that text", async () => {
		const tpl = template();
		const values = { "signer.name": "Ada Lovelace", event: "Rock & <Roll>" };
		const expected = canonicalSnapshot(renderTemplate(tpl.body, values));
		const r = await renderSnapshot(draft(), tpl.body);
		expect(r).toEqual({ ok: true, value: { text: expected, docSha256: await sha256Hex(expected) } });
		expect(expected).toContain("Rock &amp; &lt;Roll&gt;");
		expect(expected.endsWith("Signed\n")).toBe(true);
	});

	it("ES-FR-02 a guardian intent fills participant.name", async () => {
		const tpl = template({ body: "{{signer.name}} for {{participant.name}}", fields: [] });
		const d = draftFromIntent(intent({ as: "guardian", participant: { name: "Tim" } }), tpl, { now: NOW });
		if (!d.ok) throw new Error("bad fixture");
		const r = await renderSnapshot(d.value, tpl.body);
		expect(r.ok && r.value.text).toBe("Ada for Tim\n");
	});

	it("ES-FR-02 chunks stay under 512 KiB per document and rejoin exactly", () => {
		// Worst case: four-byte characters and characters JSON escapes to six bytes.
		const text = `${"😀".repeat(SNAPSHOT_CHUNK_CHARS)}${"\u0001".repeat(SNAPSHOT_CHUNK_CHARS)}tail\n`;
		const chunks = snapshotChunks("env1", text, HASH);
		expect(chunks.length).toBeGreaterThan(2);
		for (const c of chunks) {
			expect(new TextEncoder().encode(JSON.stringify(c.data)).length).toBeLessThan(MAX_DOCUMENT_BYTES);
			expect(c.data).toMatchObject({ envelopeId: "env1", sha256: HASH, count: chunks.length });
			expect(c.id.startsWith(`env1:${HASH.slice(0, 16)}:`)).toBe(true);
		}
		const shuffled = [...chunks].reverse().map((c) => c.data);
		expect(joinSnapshot(shuffled)).toBe(text);
		expect(joinSnapshot(chunks.slice(1).map((c) => c.data))).toBeNull();
		expect(joinSnapshot([])).toBeNull();
	});

	it("never splits a surrogate pair across chunks", () => {
		const text = `${"a".repeat(SNAPSHOT_CHUNK_CHARS - 1)}😀b`;
		const chunks = snapshotChunks("e", text, HASH);
		const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
		for (const c of chunks) expect(lone.test(c.data.data)).toBe(false);
		expect(joinSnapshot(chunks.map((c) => c.data))).toBe(text);
	});
});

describe("ES-FR-02 send", () => {
	it("ES-FR-02 freezes snapshot and docSha256, creates the signer with the token hash only", async () => {
		const r = await send(draft());
		if (!r.ok) throw new Error(JSON.stringify(r.error));
		const { envelope, chunks, signer } = r.value;
		const text = joinSnapshot(chunks.map((c) => c.data)) ?? "";
		expect(envelope.docSha256).toBe(await sha256Hex(canonicalSnapshot(text)));
		expect(envelope).toMatchObject({
			status: "sent",
			sentAt: LATER,
			expiresAt: "2026-11-20T11:00:00.000Z",
			signerIds: [signerDocId("env1", 1)],
			snapshot: { ids: chunks.map((c) => c.id), length: text.length },
		});
		expect(signer).toEqual({
			id: "env1:s1",
			data: {
				envelopeId: "env1",
				order: 1,
				role: "signer",
				name: "Ada Lovelace",
				email: "ada@example.com",
				as: "self",
				status: "pending",
				tokenHash: HASH,
				createdAt: LATER,
			},
		});
		expect(Object.keys(signer.data)).not.toContain("token");
	});

	it("ES-FR-02 snapshot is immutable after send: a sent envelope cannot be sent again", async () => {
		const r = await send(draft());
		if (!r.ok) throw new Error("fixture");
		const again = await send(r.value.envelope, template({ body: "Changed {{event}}" }));
		expect(again).toEqual({ ok: false, error: "ILLEGAL_TRANSITION" });
		for (const status of ["completed", "declined", "voided", "expired", "in_progress"] as const) {
			expect(await send({ ...r.value.envelope, status })).toEqual({ ok: false, error: "ILLEGAL_TRANSITION" });
		}
	});

	it("refuses a template whose version differs from the pinned one", async () => {
		expect(await send(draft(), template({ version: 3 }))).toEqual({ ok: false, error: "TEMPLATE_MISMATCH" });
	});
});

function intent(over: Partial<IntentPayload> = {}): IntentPayload {
	return {
		v: 1,
		typ: "intent",
		cid: "cl_test",
		iat: 1,
		exp: 2,
		nonce: "n".repeat(22),
		tpl: "tpl1",
		ref: "BK1:A1",
		signer: { name: "Ada", email: "Ada@Example.com" },
		prefill: {},
		returnUrl: "https://events.example/booking",
		...over,
	};
}

describe("ES-FR-02 drafts from intents", () => {
	it("records client, ref, return URL, delivery and capacity", () => {
		const tpl = template({ body: "{{event}}" });
		const d = draftFromIntent(intent({ prefill: { event: "Gig" }, delivery: "email" }), tpl, { now: NOW });
		expect(d.ok && d.value).toMatchObject({
			status: "draft",
			clientId: "cl_test",
			externalRef: "BK1:A1",
			returnUrl: "https://events.example/booking",
			delivery: "email",
			signer: { name: "Ada", email: "ada@example.com", as: "self" },
			fieldValues: { event: "Gig" },
		});
	});

	it("rejects an intent whose prefill misses a template field", () => {
		const d = draftFromIntent(intent(), template({ body: "{{event}}" }), { now: NOW });
		expect(d).toEqual({ ok: false, error: [{ path: "fields.event", code: "MISSING_FIELD" }] });
	});
});
