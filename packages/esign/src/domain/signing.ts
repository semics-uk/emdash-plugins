/**
 * The signing ceremony's pure rules (ES-FR-04): validating a submission, binding the signature to
 * `docSha256`, and the audit events a view, a signature and a decline produce. No I/O.
 *
 * A submission needs the ESIGN consent flag and the separate intent flag (both literally `true`),
 * the `docSha256` the signer saw (it must still match the envelope's), the `consentSha256` of the
 * consent wording the signer was shown (it must still match the configured wording; T117), and a
 * signature: a typed name, drawn strokes (`[x, y]` points normalised to the unit box 0-1, at most
 * 32 KB as JSON), or both. The signature is
 * bound to the document and the signer's entered values by `bindSignature` (salted with the envelope's piiSalt).
 */
import { err, ok, type Result, sha256Hex } from "@semics-tech/shared";
import type { AuditInput } from "./audit";
import { cleanFields, cleanName, isObject, type StoredSignature } from "./envelopes";

export const MAX_STROKES_JSON_BYTES = 32 * 1024;
export const MAX_STROKES = 64;
export const MAX_REASON_CODE_POINTS = 500;
const SHA256_HEX = /^[0-9a-f]{64}$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: reasons must not carry control characters.
const CONTROL = /[\u0000-\u001F\u007F]/;

export const DEFAULT_CONSENT_VERSION = "1";
export const DEFAULT_CONSENT_WORDING =
	"I agree to use electronic records and an electronic signature for this document.";

export type SubmitIssueCode =
	| "INVALID_INPUT"
	| "CONSENT_REQUIRED"
	| "INTENT_REQUIRED"
	| "INVALID_DOC_HASH"
	| "INVALID_CONSENT_HASH"
	| "CONSENT_CHANGED"
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
	/** SHA-256 of the consent wording the page showed (`public/session` returns it as `consent.sha256`). */
	consentSha256: string;
	signature: Omit<StoredSignature, "sha256">;
	fieldValues: Record<string, string>;
}

/** A pad point as `public/submit` takes it: two finite numbers in the unit box (the pad normalises to 0-1). */
const isPoint = (p: unknown): boolean =>
	Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1);

function cleanStrokes(v: unknown): Result<number[][][], SubmitIssue> {
	const bad = (code: SubmitIssueCode) => err({ path: "signature.strokes", code });
	if (!Array.isArray(v) || v.length === 0 || v.length > MAX_STROKES) return bad("INVALID_SIGNATURE");
	if (JSON.stringify(v).length > MAX_STROKES_JSON_BYTES) return bad("STROKES_TOO_LARGE");
	const valid = v.every((stroke) => Array.isArray(stroke) && stroke.length > 0 && stroke.every(isPoint));
	return valid ? ok(v as number[][][]) : bad("INVALID_SIGNATURE");
}

function parseSignature(v: unknown): Result<SubmitFields["signature"], SubmitIssue> {
	const bad = err({ path: "signature", code: "INVALID_SIGNATURE" } as SubmitIssue);
	if (!isObject(v) || (v.kind !== "typed" && v.kind !== "drawn")) return bad;
	const typedName = v.typedName === undefined ? undefined : cleanName(v.typedName);
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
	const consentSha256 =
		typeof input.consentSha256 === "string" && SHA256_HEX.test(input.consentSha256) ? input.consentSha256 : null;
	if (consentSha256 === null) issues.push({ path: "consentSha256", code: "INVALID_CONSENT_HASH" });
	const signature = parseSignature(input.signature);
	if (!signature.ok) issues.push(signature.error);
	const fieldValues = cleanFields(input.fieldValues);
	if (fieldValues === null) issues.push({ path: "fieldValues", code: "INVALID_FIELDS" });
	if (issues.length > 0 || docSha256 === null || consentSha256 === null || !signature.ok || fieldValues === null) {
		return err(issues);
	}
	return ok({ docSha256, consentSha256, signature: signature.value, fieldValues });
}

/** The optional decline reason: trimmed, no control characters, at most 500 code points. */
export function cleanReason(v: unknown): string | null | undefined {
	if (v === undefined) return undefined;
	const reason = typeof v === "string" ? v.trim() : "";
	return reason.length === 0 || [...reason].length > MAX_REASON_CODE_POINTS || CONTROL.test(reason) ? null : reason;
}

/**
 * The signature as stored, with the hash that binds it to the document and to the values the signer
 * entered (T034): `SHA256(piiSalt ‖ JSON([docSha256, kind, typedName, strokes, [[key, value]…]]))`, the
 * values in key order. The hash goes into the audit chain (`signatureSha256`), so it is salted like a
 * personal-field commitment: once the retention purge deletes the salt, a typed name or a short answer
 * can no longer be confirmed by guessing (R28).
 */
export async function bindSignature(
	docSha256: string,
	signature: SubmitFields["signature"],
	binding: { fieldValues: Readonly<Record<string, string>>; salt: string },
): Promise<StoredSignature> {
	const values = Object.keys(binding.fieldValues)
		.sort()
		.map((key) => [key, binding.fieldValues[key]]);
	const sha256 = await sha256Hex(
		binding.salt +
			JSON.stringify([docSha256, signature.kind, signature.typedName ?? null, signature.strokes ?? null, values]),
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

/** `{ signer: order }` in an envelope with several signers (T090), so the chain says whose event it is. */
export const signerData = (order?: number): Record<string, number> => (order === undefined ? {} : { signer: order });

/** `signer.viewed`: the first time the signer opens the document (`order` when there are several signers). */
export function viewedAuditEvent(at: string, docSha256: string, who: RequestPersonal, order?: number): AuditInput {
	return {
		type: "signer.viewed",
		at,
		actor: "signer",
		data: { docSha256, ...signerData(order) },
		personal: requestPersonal(who),
	};
}

/**
 * The three events of a completed single-signer envelope: consented, signed, completed. The consent
 * event records the SHA-256 of the wording that was shown beside its version, so the text is
 * identified even when the admin edited it without bumping the version (T117).
 */
export function signedAuditEvents(args: {
	at: string;
	docSha256: string;
	consentVersion: string;
	consentSha256: string;
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
			data: { docSha256, consentVersion: args.consentVersion, consentSha256: args.consentSha256, intent: true },
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
	/** The signer's order when the envelope has several signers (T090). */
	order?: number;
}): AuditInput[] {
	const { at, docSha256, hasReason } = args;
	return [
		{
			type: "signer.declined",
			at,
			actor: "signer",
			data: { docSha256, hasReason, ...signerData(args.order) },
			personal: requestPersonal(args.who),
		},
		{ type: "envelope.declined", at, actor: "system", data: { docSha256 } },
	];
}
