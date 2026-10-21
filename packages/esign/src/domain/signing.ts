/**
 * The signing ceremony's pure rules (ES-FR-04): validating a submission, binding the signature to
 * `docSha256`, and the audit events a view, a signature and a decline produce. No I/O.
 *
 * A submission needs the ESIGN consent flag and the separate intent flag (both literally `true`),
 * the `docSha256` the signer saw (it must still match the envelope's), and a signature: a typed
 * name, drawn strokes (normalised `[x, y]` points, at most 32 KB as JSON), or both. The signature is
 * bound to the document by `signature.sha256 = SHA256(JSON([docSha256, kind, typedName, strokes]))`.
 */
import { err, ok, type Result, sha256Hex } from "@semics-tech/shared";
import type { AuditInput } from "./audit";
import type { StoredSignature } from "./envelopes";

export const MAX_STROKES_JSON_BYTES = 32 * 1024;
export const MAX_STROKES = 64;
export const MAX_REASON_CODE_POINTS = 500;
const NAME_MAX = 200;
const MAX_FIELDS = 32;
const MAX_FIELD_VALUE_CODE_POINTS = 500;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const FIELD_KEY = /^[A-Za-z0-9_]{1,64}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: names must not carry control characters.
const CONTROL = /[\u0000-\u001F\u007F]/;

export const DEFAULT_CONSENT_VERSION = "1";
export const DEFAULT_CONSENT_WORDING =
	"I agree to sign this document electronically and that my electronic signature has the same legal effect as a handwritten one.";

export type SubmitIssueCode =
	| "INVALID_INPUT"
	| "CONSENT_REQUIRED"
	| "INTENT_REQUIRED"
	| "INVALID_DOC_HASH"
	| "INVALID_SIGNATURE"
	| "STROKES_TOO_LARGE"
	| "INVALID_FIELDS"
	| "DOC_CHANGED";

export interface SubmitIssue {
	path: string;
	code: SubmitIssueCode;
}

export interface SubmitFields {
	docSha256: string;
	signature: Omit<StoredSignature, "sha256">;
	fieldValues: Record<string, string>;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const isPoint = (p: unknown): boolean =>
	Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n));

function cleanStrokes(v: unknown): Result<number[][][], SubmitIssue> {
	const bad = (code: SubmitIssueCode) => err({ path: "signature.strokes", code });
	if (!Array.isArray(v) || v.length === 0 || v.length > MAX_STROKES) return bad("INVALID_SIGNATURE");
	if (JSON.stringify(v).length > MAX_STROKES_JSON_BYTES) return bad("STROKES_TOO_LARGE");
	const valid = v.every((stroke) => Array.isArray(stroke) && stroke.length > 0 && stroke.every(isPoint));
	return valid ? ok(v as number[][][]) : bad("INVALID_SIGNATURE");
}

function cleanTypedName(v: unknown): string | null {
	const name = typeof v === "string" ? v.trim() : "";
	return name.length > 0 && name.length <= NAME_MAX && !CONTROL.test(name) ? name : null;
}

function cleanFieldValues(v: unknown): Record<string, string> | null {
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

function parseSignature(v: unknown): Result<SubmitFields["signature"], SubmitIssue> {
	const bad = err({ path: "signature", code: "INVALID_SIGNATURE" } as SubmitIssue);
	if (!isObject(v) || (v.kind !== "typed" && v.kind !== "drawn")) return bad;
	const typedName = v.typedName === undefined ? undefined : cleanTypedName(v.typedName);
	if (typedName === null) return bad;
	if (v.kind === "typed") return typedName === undefined ? bad : ok({ kind: "typed", typedName });
	const strokes = cleanStrokes(v.strokes);
	if (!strokes.ok) return strokes;
	return ok({ kind: "drawn", ...(typedName === undefined ? {} : { typedName }), strokes: strokes.value });
}

/** Validates the `public/submit` body (the token is checked by the route). Every problem is reported. */
export function parseSubmit(input: unknown): Result<SubmitFields, SubmitIssue[]> {
	if (!isObject(input)) return err([{ path: "", code: "INVALID_INPUT" }]);
	const issues: SubmitIssue[] = [];
	if (input.consent !== true) issues.push({ path: "consent", code: "CONSENT_REQUIRED" });
	if (input.intent !== true) issues.push({ path: "intent", code: "INTENT_REQUIRED" });
	const docSha256 = typeof input.docSha256 === "string" && SHA256_HEX.test(input.docSha256) ? input.docSha256 : null;
	if (docSha256 === null) issues.push({ path: "docSha256", code: "INVALID_DOC_HASH" });
	const signature = parseSignature(input.signature);
	if (!signature.ok) issues.push(signature.error);
	const fieldValues = cleanFieldValues(input.fieldValues);
	if (fieldValues === null) issues.push({ path: "fieldValues", code: "INVALID_FIELDS" });
	if (issues.length > 0 || docSha256 === null || !signature.ok || fieldValues === null) return err(issues);
	return ok({ docSha256, signature: signature.value, fieldValues });
}

/** The optional decline reason: trimmed, no control characters, at most 500 code points. */
export function cleanReason(v: unknown): string | null | undefined {
	if (v === undefined) return undefined;
	const reason = typeof v === "string" ? v.trim() : "";
	return reason.length === 0 || [...reason].length > MAX_REASON_CODE_POINTS || CONTROL.test(reason) ? null : reason;
}

/** The signature as stored, with the hash that binds it to the document. */
export async function bindSignature(docSha256: string, signature: SubmitFields["signature"]): Promise<StoredSignature> {
	const sha256 = await sha256Hex(
		JSON.stringify([docSha256, signature.kind, signature.typedName ?? null, signature.strokes ?? null]),
	);
	return { ...signature, sha256 };
}

export interface RequestPersonal {
	ip?: string;
	ua?: string;
}

const requestPersonal = (who: RequestPersonal) => ({
	...(who.ip === undefined ? {} : { ip: who.ip }),
	...(who.ua === undefined ? {} : { ua: who.ua }),
});

/** `signer.viewed`: the first time the signer opens the document. */
export function viewedAuditEvent(at: string, docSha256: string, who: RequestPersonal): AuditInput {
	return { type: "signer.viewed", at, actor: "signer", data: { docSha256 }, personal: requestPersonal(who) };
}

/** The three events of a completed single-signer envelope: consented, signed, completed. */
export function signedAuditEvents(args: {
	at: string;
	docSha256: string;
	consentVersion: string;
	signature: StoredSignature;
	signerName: string;
	who: RequestPersonal;
}): AuditInput[] {
	const { at, docSha256, signature } = args;
	return [
		{
			type: "signer.consented",
			at,
			actor: "signer",
			data: { docSha256, consentVersion: args.consentVersion, intent: true },
			personal: requestPersonal(args.who),
		},
		{
			type: "signer.signed",
			at,
			actor: "signer",
			data: { docSha256, kind: signature.kind, signatureSha256: signature.sha256 },
			personal: { name: signature.typedName ?? args.signerName, ...requestPersonal(args.who) },
		},
		{ type: "envelope.completed", at, actor: "system", data: { docSha256 } },
	];
}

/** `signer.declined` then `envelope.declined`. The free-text reason is kept off the chain. */
export function declinedAuditEvents(args: {
	at: string;
	docSha256: string | null;
	hasReason: boolean;
	who: RequestPersonal;
}): AuditInput[] {
	const { at, docSha256, hasReason } = args;
	return [
		{
			type: "signer.declined",
			at,
			actor: "signer",
			data: { docSha256, hasReason },
			personal: requestPersonal(args.who),
		},
		{ type: "envelope.declined", at, actor: "system", data: { docSha256 } },
	];
}
