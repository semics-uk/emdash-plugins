/** Envelopes, snapshots and signers (ES-FR-02). Red-phase stub. */
import type { IntentPayload, Result } from "@semics-tech/shared";
import type { EnvelopeStatus } from "./state";
import type { TemplateDoc } from "./templates";

export type SignerCapacity = "self" | "guardian" | "buyer";
export type Delivery = "inline" | "email";

export interface SignerInput {
	name: string;
	email: string;
	as: SignerCapacity;
	participant?: { name: string };
}

export interface EnvelopeDoc {
	title: string;
	templateId: string;
	templateVersion: number;
	status: EnvelopeStatus;
	routing: "parallel";
	delivery: Delivery;
	clientId?: string;
	externalRef?: string;
	returnUrl?: string;
	signer: SignerInput;
	fieldValues: Record<string, string>;
	signerIds: string[];
	docSha256: string | null;
	snapshot: { ids: string[]; length: number } | null;
	expiresAt: string | null;
	sentAt: string | null;
	completedAt: string | null;
	finalHash: string | null;
	createdAt: string;
	updatedAt: string;
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
	createdAt: string;
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
}

export const SNAPSHOT_CHUNK_CHARS = 64 * 1024;
export const MAX_DOCUMENT_BYTES = 512 * 1024;

export const signerDocId = (envelopeId: string, order: number): string => `${envelopeId}:s${order}`;

export function parseDraftInput(_input: unknown): Result<DraftFields, EnvelopeIssue[]> {
	throw new Error("not implemented");
}

export function pickTemplateVersion(
	_head: TemplateDoc | undefined,
	_version: TemplateDoc | undefined,
	_requested: number | undefined,
): Result<TemplateDoc, "TEMPLATE_NOT_FOUND"> {
	throw new Error("not implemented");
}

export function buildDraft(
	_fields: DraftFields,
	_template: TemplateDoc,
	_ctx: { now: string },
): Result<EnvelopeDoc, EnvelopeIssue[]> {
	throw new Error("not implemented");
}

export function draftFromIntent(
	_intent: IntentPayload,
	_template: TemplateDoc,
	_ctx: { now: string },
): Result<EnvelopeDoc, EnvelopeIssue[]> {
	throw new Error("not implemented");
}

export function renderSnapshot(_envelope: EnvelopeDoc, _body: string): Promise<Result<{ text: string; docSha256: string }, EnvelopeIssue[]>> {
	throw new Error("not implemented");
}

export function snapshotChunks(
	_envelopeId: string,
	_text: string,
	_docSha256: string,
): Array<{ id: string; data: SnapshotChunkDoc }> {
	throw new Error("not implemented");
}

export function joinSnapshot(_chunks: readonly SnapshotChunkDoc[]): string {
	throw new Error("not implemented");
}

export interface SentEnvelope {
	envelope: EnvelopeDoc;
	chunks: Array<{ id: string; data: SnapshotChunkDoc }>;
	signer: { id: string; data: SignerDoc };
}

export function sendEnvelope(
	_envelopeId: string,
	_envelope: EnvelopeDoc,
	_template: TemplateDoc,
	_ctx: { now: string; tokenHash: string; expiryDays: number },
): Promise<Result<SentEnvelope, EnvelopeIssue[] | "ILLEGAL_TRANSITION" | "TEMPLATE_MISMATCH">> {
	throw new Error("not implemented");
}
