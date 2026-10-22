/**
 * Envelopes, snapshots and signers (ES-FR-02). Pure: no I/O; ids, the clock and the signer token
 * hash are injected.
 *
 * Lifecycle: an envelope is built as a `draft` that pins a template version and the field values.
 * `sendEnvelope` freezes it: it renders the template (`renderTemplate`, values HTML-escaped, T017),
 * takes the canonical form as the snapshot text, and records
 * `docSha256 = sha256Hex(canonicalSnapshot(rendered))`. The ceremony shows exactly the stored
 * snapshot text, whose hash is `docSha256` (canonicalisation is idempotent). Sending is the
 * `draft → sent` transition, so a sent envelope can never be re-rendered: the snapshot is
 * immutable after send, whatever happens to the template later.
 *
 * Storage layout:
 *  - `envelopes/<id>`: the envelope document below;
 *  - `snapshots/<id>:<docSha256[0..16]>:<i>`: the snapshot text in chunks of at most
 *    `SNAPSHOT_CHUNK_CHARS` UTF-16 units (≤ 384 KiB as JSON even for worst-case characters, inside
 *    the 512 KiB document limit). Hash-addressed ids mean a racing writer can never overwrite the
 *    chunks of a different snapshot;
 *  - `signers/<id>:s<order>`: one signer (Free), holding only the SHA-256 of the signing token.
 */
import {
	canonicalSnapshot,
	err,
	type IntentPayload,
	ok,
	type Result,
	renderTemplate,
	sha256Hex,
	TemplateError,
	templateFields,
	toIso,
} from "@semics-tech/shared";
import type { AuditInput } from "./audit";
import type { StoredPdf } from "./pdf";
import { canTransition, type EnvelopeStatus } from "./state";
import { type TemplateDoc, usableForNewEnvelope } from "./templates";

export type SignerCapacity = "self" | "guardian" | "buyer";
export type Delivery = "inline" | "email";

export interface SignerInput {
	name: string;
	email: string;
	as: SignerCapacity;
	participant?: { name: string };
}

/** A value the signer fills in at the ceremony (`public/session` lists them; `public/submit` stores them). */
export interface SignerFieldSpec {
	key: string;
	label: string;
	required?: boolean;
}

export const MAX_SIGNER_FIELDS = 16;
const MAX_LABEL_CODE_POINTS = 100;

export interface EnvelopeDoc {
	title: string;
	templateId: string;
	templateVersion: number;
	status: EnvelopeStatus;
	/** Several signers (E-sign Pro, T090): `sequential` invites each signer once the one before has signed. */
	routing: "parallel" | "sequential";
	delivery: Delivery;
	clientId?: string;
	externalRef?: string;
	returnUrl?: string;
	signer: SignerInput;
	/** Lower-cased `signer.email`, indexed so deletion by email finds drafts (no signer document yet); purged with the rest (T092). */
	signerEmail?: string;
	fieldValues: Record<string, string>;
	/** Fields the signer fills in at signing; absent when the sender asked for none. */
	signerFields?: SignerFieldSpec[];
	signerIds: string[];
	docSha256: string | null;
	snapshot: { ids: string[]; length: number } | null;
	expiresAt: string | null;
	sentAt: string | null;
	completedAt: string | null;
	/** When a decline or void closed the envelope (T062: the receipt's `at`); absent on older envelopes. */
	closedAt?: string | null;
	finalHash: string | null;
	/** SHA-256 of the stored signed PDF (domain/pdf.ts); absent until the PDF job has run. */
	pdfSha256?: string | null;
	/** Where the signed PDF's chunks are (`artifacts`), set with `pdfSha256`. */
	pdf?: StoredPdf | null;
	/** Per-envelope salt for the audit commitments (domain/audit.ts); never returned by a route. */
	piiSalt: string;
	createdAt: string;
	updatedAt: string;
	/** Set by the retention purge (cron/retention.ts), which also deletes `piiSalt`. */
	personalPurgedAt?: string;
	/** Set when the signed-records period ended: the envelope is a tombstone (R45). */
	recordsPurgedAt?: string;
}

export interface SignerDoc {
	envelopeId: string;
	order: number;
	role: "signer";
	name: string;
	email: string;
	as: SignerCapacity;
	participant?: { name: string };
	status: "pending" | "signed" | "declined";
	tokenHash: string;
	/** SHA-256 of the signed-copy token the completion email links (R36); never opens a signing session. */
	copyTokenHash?: string;
	createdAt: string;
	/** First view in an envelope with several signers (T090): each signer's `signer.viewed` is written once. */
	viewedAt?: string;
	/** Set by the signing ceremony (domain/signing.ts). Personal data: purged by retention. */
	signature?: StoredSignature;
	consentAt?: string;
	consentVersion?: string;
	/** SHA-256 of the consent wording the signer was shown (T117). */
	consentSha256?: string;
	signedAt?: string;
	fieldValues?: Record<string, string>;
	declinedAt?: string;
	declineReason?: string;
	ip?: string;
	ua?: string;
}

export interface StoredSignature {
	kind: "typed" | "drawn";
	typedName?: string;
	strokes?: number[][][];
	/** SHA-256 binding the signature to `docSha256` (domain/signing.ts). */
	sha256: string;
}

export interface SnapshotChunkDoc {
	envelopeId: string;
	contentType: "text/markdown";
	index: number;
	count: number;
	data: string;
	sha256: string;
}

export type EnvelopeIssueCode =
	| "INVALID_INPUT"
	| "INVALID_TEMPLATE_ID"
	| "INVALID_VERSION"
	| "INVALID_TITLE"
	| "INVALID_SIGNER_NAME"
	| "INVALID_SIGNER_EMAIL"
	| "INVALID_FIELDS"
	| "MISSING_FIELD";

export interface EnvelopeIssue {
	path: string;
	code: EnvelopeIssueCode;
}

export interface DraftFields {
	templateId: string;
	templateVersion?: number;
	title?: string;
	signer: SignerInput;
	fieldValues: Record<string, string>;
	signerFields?: SignerFieldSpec[];
}

/** UTF-16 units per snapshot chunk: worst case 64Ki × 6 bytes of JSON escapes = 384 KiB. */
export const SNAPSHOT_CHUNK_CHARS = 64 * 1024;
export const MAX_DOCUMENT_BYTES = 512 * 1024;
export const MAX_TITLE_LENGTH = 200;
export const MAX_FIELDS = 32;
export const MAX_FIELD_VALUE_CODE_POINTS = 500;

const NAME_MAX = 200;
const EMAIL_MAX = 254;
// biome-ignore lint/suspicious/noControlCharactersInRegex: names and titles must not carry control characters.
const CONTROL = /[\u0000-\u001F\u007F]/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FIELD_KEY = /^[A-Za-z0-9_]{1,64}$/;
const DAY_MS = 86_400_000;

export const signerDocId = (envelopeId: string, order: number): string => `${envelopeId}:s${order}`;

export const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const isId = (v: unknown): v is string => typeof v === "string" && v.length > 0 && v.length <= 200 && !v.includes(":");

/** A trimmed name or title of 1 to 200 characters with no control characters. */
export function cleanName(v: unknown): string | null {
	const name = typeof v === "string" ? v.trim() : "";
	return name.length > 0 && name.length <= NAME_MAX && !CONTROL.test(name) ? name : null;
}

function cleanEmail(v: unknown): string | null {
	const email = typeof v === "string" ? v.trim().toLowerCase() : "";
	return email.length <= EMAIL_MAX && EMAIL.test(email) ? email : null;
}

/** Field values: at most 32 `[A-Za-z0-9_]` keys, each a string of at most 500 code points. */
export function cleanFields(v: unknown): Record<string, string> | null {
	if (v === undefined) return {};
	if (!isObject(v)) return null;
	const entries = Object.entries(v);
	if (entries.length > MAX_FIELDS) return null;
	const out: Record<string, string> = {};
	for (const [key, value] of entries) {
		if (!FIELD_KEY.test(key) || typeof value !== "string") return null;
		if ([...value].length > MAX_FIELD_VALUE_CODE_POINTS) return null;
		out[key] = value;
	}
	return out;
}

function cleanSignerFields(v: unknown): SignerFieldSpec[] | null {
	if (v === undefined) return [];
	if (!Array.isArray(v) || v.length > MAX_SIGNER_FIELDS) return null;
	const out: SignerFieldSpec[] = [];
	for (const f of v) {
		if (!isObject(f) || typeof f.key !== "string" || !FIELD_KEY.test(f.key) || out.some((o) => o.key === f.key)) {
			return null;
		}
		const label = typeof f.label === "string" ? f.label.trim() : "";
		if (label === "" || [...label].length > MAX_LABEL_CODE_POINTS || CONTROL.test(label)) return null;
		if (f.required !== undefined && typeof f.required !== "boolean") return null;
		out.push({ key: f.key, label, ...(f.required ? { required: true } : {}) });
	}
	return out;
}

/** Validates the private `envelopes/create` input. */
export function parseDraftInput(input: unknown): Result<DraftFields, EnvelopeIssue[]> {
	if (!isObject(input)) return err([{ path: "", code: "INVALID_INPUT" }]);
	const { templateId, templateVersion, title, signer, fields } = input;
	const issues: EnvelopeIssue[] = [];
	if (!isId(templateId)) issues.push({ path: "templateId", code: "INVALID_TEMPLATE_ID" });
	if (templateVersion !== undefined && !(Number.isSafeInteger(templateVersion) && (templateVersion as number) >= 1)) {
		issues.push({ path: "templateVersion", code: "INVALID_VERSION" });
	}
	const cleanTitle = typeof title === "string" ? title.trim() : undefined;
	if (title !== undefined && !(cleanTitle && cleanTitle.length <= MAX_TITLE_LENGTH && !CONTROL.test(cleanTitle))) {
		issues.push({ path: "title", code: "INVALID_TITLE" });
	}
	const s = isObject(signer) ? signer : {};
	const name = cleanName(s.name);
	const email = cleanEmail(s.email);
	if (name === null) issues.push({ path: "signer.name", code: "INVALID_SIGNER_NAME" });
	if (email === null) issues.push({ path: "signer.email", code: "INVALID_SIGNER_EMAIL" });
	const fieldValues = cleanFields(fields);
	if (fieldValues === null) issues.push({ path: "fields", code: "INVALID_FIELDS" });
	const signerFields = cleanSignerFields(input.signerFields);
	if (signerFields === null) issues.push({ path: "signerFields", code: "INVALID_FIELDS" });
	if (issues.length > 0) return err(issues);
	return ok({
		templateId: templateId as string,
		...(templateVersion === undefined ? {} : { templateVersion: templateVersion as number }),
		...(cleanTitle === undefined ? {} : { title: cleanTitle }),
		signer: { name: name as string, email: email as string, as: "self" },
		fieldValues: fieldValues as Record<string, string>,
		...(signerFields && signerFields.length > 0 ? { signerFields } : {}),
	});
}

/**
 * The template version an envelope may use: the head (which carries the latest version) when no
 * version is requested, else that version's immutable document. Archived or missing templates, and
 * ids that point at a version document, look missing.
 */
export function pickTemplateVersion(
	head: TemplateDoc | undefined,
	version: TemplateDoc | undefined,
	requested: number | undefined,
): Result<TemplateDoc, "TEMPLATE_NOT_FOUND"> {
	const usable = head ? usableForNewEnvelope(head) : err("TEMPLATE_NOT_FOUND" as const);
	if (!usable.ok || requested === undefined) return usable;
	return version?.status === "version" && version.version === requested ? ok(version) : err("TEMPLATE_NOT_FOUND");
}

/** Values the template sees: the field values plus the built-in `signer.*` and `participant.name`. */
function renderValues(envelope: Pick<EnvelopeDoc, "fieldValues" | "signer">): Record<string, string> {
	const { signer } = envelope;
	return {
		...envelope.fieldValues,
		"signer.name": signer.name,
		"signer.email": signer.email,
		...(signer.participant ? { "participant.name": signer.participant.name } : {}),
	};
}

function missingFields(envelope: EnvelopeDoc, body: string): EnvelopeIssue[] {
	const values = renderValues(envelope);
	return templateFields(body)
		.filter((field) => !Object.hasOwn(values, field))
		.map((field) => ({ path: `fields.${field}`, code: "MISSING_FIELD" as const }));
}

function draftDoc(
	base: Pick<EnvelopeDoc, "templateId" | "signer" | "fieldValues" | "delivery"> &
		Partial<Pick<EnvelopeDoc, "clientId" | "externalRef" | "returnUrl" | "title" | "signerFields">>,
	template: TemplateDoc,
	ctx: { now: string; piiSalt: string },
): Result<EnvelopeDoc, EnvelopeIssue[]> {
	const { title, ...rest } = base;
	const envelope: EnvelopeDoc = {
		title: title ?? template.name,
		templateVersion: template.version,
		status: "draft",
		routing: "parallel",
		...rest,
		signerEmail: rest.signer.email.toLowerCase(),
		signerIds: [],
		docSha256: null,
		snapshot: null,
		expiresAt: null,
		sentAt: null,
		completedAt: null,
		finalHash: null,
		piiSalt: ctx.piiSalt,
		createdAt: ctx.now,
		updatedAt: ctx.now,
	};
	const missing = missingFields(envelope, template.body);
	return missing.length > 0 ? err(missing) : ok(envelope);
}

/** A draft from the private create route. Every template field must have a value. */
export function buildDraft(
	fields: DraftFields,
	template: TemplateDoc,
	ctx: { now: string; piiSalt: string },
): Result<EnvelopeDoc, EnvelopeIssue[]> {
	return draftDoc(
		{
			templateId: fields.templateId,
			signer: fields.signer,
			fieldValues: fields.fieldValues,
			delivery: "email",
			...(fields.title === undefined ? {} : { title: fields.title }),
			...(fields.signerFields ? { signerFields: fields.signerFields } : {}),
		},
		template,
		ctx,
	);
}

/** A draft from a verified SigningIntent; `prefill` supplies the field values. */
export function draftFromIntent(
	intent: IntentPayload,
	template: TemplateDoc,
	ctx: { now: string; piiSalt: string },
): Result<EnvelopeDoc, EnvelopeIssue[]> {
	const signer: SignerInput = {
		name: intent.signer.name.trim(),
		email: intent.signer.email.trim().toLowerCase(),
		as: intent.as ?? "self",
		...(intent.participant ? { participant: { name: intent.participant.name.trim() } } : {}),
	};
	return draftDoc(
		{
			templateId: intent.tpl,
			signer,
			fieldValues: { ...intent.prefill },
			delivery: intent.delivery ?? "inline",
			clientId: intent.cid,
			externalRef: intent.ref,
			returnUrl: intent.returnUrl,
		},
		template,
		ctx,
	);
}

/** The canonical snapshot text and its `docSha256`. */
export async function renderSnapshot(
	envelope: EnvelopeDoc,
	body: string,
): Promise<Result<{ text: string; docSha256: string }, EnvelopeIssue[]>> {
	let rendered: string;
	try {
		rendered = renderTemplate(body, renderValues(envelope));
	} catch (error) {
		if (error instanceof TemplateError) return err([{ path: `fields.${error.field}`, code: "MISSING_FIELD" }]);
		throw error;
	}
	const text = canonicalSnapshot(rendered);
	return ok({ text, docSha256: await sha256Hex(text) });
}

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;

/** Splits the snapshot into storage documents, never inside a surrogate pair. */
export function snapshotChunks(
	envelopeId: string,
	text: string,
	docSha256: string,
): Array<{ id: string; data: SnapshotChunkDoc }> {
	const parts: string[] = [];
	for (let start = 0; start < text.length; ) {
		let end = Math.min(start + SNAPSHOT_CHUNK_CHARS, text.length);
		if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end--;
		parts.push(text.slice(start, end));
		start = end;
	}
	const prefix = `${envelopeId}:${docSha256.slice(0, 16)}`;
	return parts.map((data, index) => ({
		id: `${prefix}:${index}`,
		data: { envelopeId, contentType: "text/markdown", index, count: parts.length, data, sha256: docSha256 },
	}));
}

/** Reassembles chunks in any order; `null` when any chunk is missing or they disagree. */
export function joinSnapshot(chunks: readonly SnapshotChunkDoc[]): string | null {
	const first = chunks[0];
	if (!first || chunks.length !== first.count) return null;
	const ordered = [...chunks].sort((a, b) => a.index - b.index);
	const consistent = ordered.every((c, i) => c.index === i && c.count === first.count && c.sha256 === first.sha256);
	return consistent ? ordered.map((c) => c.data).join("") : null;
}

export interface SentEnvelope {
	envelope: EnvelopeDoc;
	chunks: Array<{ id: string; data: SnapshotChunkDoc }>;
	signer: { id: string; data: SignerDoc };
}

export type SendError = EnvelopeIssue[] | "ILLEGAL_TRANSITION" | "TEMPLATE_MISMATCH";

/**
 * `draft → sent`: freezes the snapshot and `docSha256`, sets the expiry and builds the signer, who
 * holds only `tokenHash`. `template` must be the pinned version.
 */
export async function sendEnvelope(
	envelopeId: string,
	envelope: EnvelopeDoc,
	template: TemplateDoc,
	ctx: { now: string; tokenHash: string; expiryDays: number },
): Promise<Result<SentEnvelope, SendError>> {
	if (!canTransition(envelope.status, "sent")) return err("ILLEGAL_TRANSITION");
	if (template.version !== envelope.templateVersion) return err("TEMPLATE_MISMATCH");
	const snapshot = await renderSnapshot(envelope, template.body);
	if (!snapshot.ok) return snapshot;
	const { text, docSha256 } = snapshot.value;
	const chunks = snapshotChunks(envelopeId, text, docSha256);
	const signerId = signerDocId(envelopeId, 1);
	const { signer } = envelope;
	return ok({
		envelope: {
			...envelope,
			status: "sent",
			docSha256,
			snapshot: { ids: chunks.map((c) => c.id), length: text.length },
			signerIds: [signerId],
			sentAt: ctx.now,
			expiresAt: toIso(Date.parse(ctx.now) + ctx.expiryDays * DAY_MS),
			updatedAt: ctx.now,
		},
		chunks,
		signer: {
			id: signerId,
			data: {
				envelopeId,
				order: 1,
				role: "signer",
				name: signer.name,
				email: signer.email,
				as: signer.as,
				...(signer.participant ? { participant: signer.participant } : {}),
				status: "pending",
				tokenHash: ctx.tokenHash,
				createdAt: ctx.now,
			},
		},
	});
}

/** Statuses after which a `(clientId, externalRef)` pair gets a fresh envelope (protocol §8.1). */
const RETRYABLE: readonly EnvelopeStatus[] = ["declined", "voided", "expired"];

/** The envelope an intent for this `(cid, ref)` must return, if any (protocol §8.1 idempotency). */
export function existingForRef<T extends { data: Pick<EnvelopeDoc, "status"> }>(items: readonly T[]): T | undefined {
	return items.find((item) => !RETRYABLE.includes(item.data.status));
}

/**
 * Deterministic id for the `attempt`-th envelope of a `(cid, ref)` pair, so two racing intents for
 * the same pair collide on a create-only write instead of creating two envelopes.
 */
export async function envelopeIdForRef(cid: string, ref: string, attempt: number): Promise<string> {
	return `env_${(await sha256Hex(`${cid}\n${ref}`)).slice(0, 32)}_${attempt}`;
}

/** Who started an envelope: an admin (private routes) or an integration (a verified intent). */
export type EnvelopeActor = "admin" | "integration";

/**
 * The `envelope.created` audit event (ES-FR-05); the signer's name and email are personal fields.
 * `userId` is the acting admin's user id (`routeCtx.user.id`, T117): an opaque id, never an email.
 */
export function createdAuditEvent(envelope: EnvelopeDoc, actor: EnvelopeActor, userId?: string): AuditInput {
	const { signer, clientId, externalRef } = envelope;
	return {
		type: "envelope.created",
		at: envelope.createdAt,
		actor,
		data: {
			source: actor === "admin" ? "admin" : "intent",
			templateId: envelope.templateId,
			templateVersion: envelope.templateVersion,
			title: envelope.title,
			delivery: envelope.delivery,
			as: signer.as,
			...(clientId === undefined ? {} : { clientId }),
			...(externalRef === undefined ? {} : { externalRef }),
			...(userId ? { userId } : {}),
		},
		personal: {
			name: signer.name,
			email: signer.email,
			...(signer.participant ? { participant: signer.participant.name } : {}),
		},
	};
}

/** The `envelope.sent` audit event for an envelope `sendEnvelope` just froze (`at` = the send time; `userId` as above). */
export function sentAuditEvent(envelope: EnvelopeDoc, actor: EnvelopeActor, userId?: string): AuditInput {
	return {
		type: "envelope.sent",
		at: envelope.updatedAt,
		actor,
		data: {
			docSha256: envelope.docSha256,
			expiresAt: envelope.expiresAt,
			signerIds: envelope.signerIds.join(","),
			...(userId ? { userId } : {}),
		},
		personal: { email: envelope.signer.email },
	};
}
