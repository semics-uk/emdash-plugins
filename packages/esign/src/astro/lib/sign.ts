import { callPublicRoute, type PublicRouteContext } from "./call.ts";

/**
 * The signing page's logic (SU-FR-01), kept out of the `.astro` file so it is testable. The token is
 * the page path; here it only ever goes into POST bodies. `public/session` is always called first. A
 * GET only looks (mail scanners prefetch emailed links, T117); the first POST, sign or decline, asks it
 * to `open` the envelope, which records the first view (R31). A submit is bound to the document hash
 * and the consent wording's hash that session returned.
 */

export interface SessionData {
	ok: true;
	state: "ready" | "closed";
	status?: string;
	title?: string;
	pdf?: "pending" | "ready";
	download?: { url: string; expiresAt: string };
	envelope?: { id: string; title: string; status: string; docSha256: string | null; expiresAt: string | null };
	signer?: { name: string; as?: string; participant?: string };
	snapshot?: string;
	/** An emailed one-time code is needed before signing (E-sign Pro, T091); `verified` once it has been entered. */
	otp?: "required" | "verified";
	/** `sha256` is the SHA-256 of `wording`, posted back with the signature (T117). */
	consent?: { version: string; wording: string; sha256?: string };
	/** Values the signer fills in (`fieldValues` on submit). */
	fields?: SessionField[];
	/** A closed integration envelope: where to return, and its signed receipt (T062). */
	returnUrl?: string;
	receipt?: string;
}

/** What submit and decline answer with besides `ok` (T062: `receipt` for an integration's envelope). */
interface Done {
	/** `completed`, or still open (`in_progress`) while other signers have to sign (T090). */
	status?: string;
	returnUrl?: string;
	receipt?: string;
}

export interface SessionField {
	key: string;
	label: string;
	required?: boolean;
}

/** Field keys as `public/submit` accepts them; others are never rendered or sent. */
export const FIELD_KEY = /^[A-Za-z0-9_]{1,64}$/;

/** The form control name of a session field. */
export const fieldName = (key: string) => `field.${key}`;

/** The session's fields that can be rendered and posted. */
export const sessionFields = (session: SessionData): SessionField[] =>
	(Array.isArray(session.fields) ? session.fields : []).filter(
		(f) => f && typeof f.key === "string" && FIELD_KEY.test(f.key) && typeof f.label === "string",
	);

/** Limits of `public/submit` (T024): at most 64 strokes, at most 32 KB of stroke JSON. */
export const MAX_STROKES = 64;
export const MAX_STROKES_JSON_BYTES = 32 * 1024;
/** Raw pad JSON larger than this is not even parsed. */
const MAX_PAD_JSON = 512 * 1024;

const toPoint = (p: unknown): [number, number] | undefined => {
	let x: unknown;
	let y: unknown;
	if (Array.isArray(p)) [x, y] = p;
	else if (p !== null && typeof p === "object") ({ x, y } = p as { x?: unknown; y?: unknown });
	return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
		? [x, y]
		: undefined;
};

const unit = (n: number, size: number) => Math.round(Math.min(1, Math.max(0, n / size)) * 1000) / 1000;

/**
 * The signature pad's `{ v, w, h, strokes }` (pad coordinates, y down; T031) as `public/submit`
 * takes it: `[x, y]` points normalised to 0-1 (the PDF draws them in a 1 x 1 box), three decimals.
 */
export function normaliseStrokes(
	pad: unknown,
): { ok: true; strokes: number[][][] } | { ok: false; code: "INVALID_SIGNATURE" | "STROKES_TOO_LARGE" } {
	const invalid = { ok: false, code: "INVALID_SIGNATURE" } as const;
	if (pad === null || typeof pad !== "object") return invalid;
	const { w, h, strokes } = pad as { w?: unknown; h?: unknown; strokes?: unknown };
	if (typeof w !== "number" || typeof h !== "number" || !(w > 0) || !(h > 0) || !Number.isFinite(w * h)) return invalid;
	if (!Array.isArray(strokes)) return invalid;
	const out: number[][][] = [];
	for (const stroke of strokes) {
		const points = (Array.isArray(stroke) ? stroke : [])
			.map(toPoint)
			.filter((p): p is [number, number] => p !== undefined)
			.map(([x, y]) => [unit(x, w), unit(y, h)]);
		if (points.length > 0) out.push(points);
	}
	if (out.length === 0 || out.length > MAX_STROKES) return invalid;
	if (JSON.stringify(out).length > MAX_STROKES_JSON_BYTES) return { ok: false, code: "STROKES_TOO_LARGE" };
	return { ok: true, strokes: out };
}

/** The drawn signature in the form, if any: `undefined` for none, else the normalised strokes or why not. */
function formStrokes(form: FormData): ReturnType<typeof normaliseStrokes> | undefined {
	const raw = form.get("signatureStrokes");
	if (typeof raw !== "string" || raw.trim() === "") return undefined;
	if (raw.length > MAX_PAD_JSON) return { ok: false, code: "STROKES_TOO_LARGE" };
	try {
		return normaliseStrokes(JSON.parse(raw));
	} catch {
		return { ok: false, code: "INVALID_SIGNATURE" };
	}
}

/** Where the core's submit issues show on the form. */
const ISSUE_FIELD: Record<string, string> = {
	intent: "agree",
	"signature.strokes": "signature",
	fieldValues: "fields",
};

export type SignView =
	| { kind: "error"; code: string; message: string }
	| {
			kind: "ready";
			session: SessionData;
			/** Form fields to fix (`typedName`, `consent`, `agree`). */
			fields?: string[];
			errorCode?: string;
			message?: string;
			/** A one-time code was just emailed (T091). */
			otpSent?: true;
	  }
	| { kind: "closed"; status: string; title?: string; pdf?: "pending" | "ready"; download?: string; returnUrl?: string }
	| { kind: "signed"; returnUrl?: string; download?: string; pdf?: "pending" | "ready"; waiting?: true }
	/** SU-FR-11: this signer has signed; the envelope waits for the other signers (T090). */
	| { kind: "waiting"; title?: string }
	| { kind: "declined"; returnUrl?: string };

export const MESSAGES: Record<string, string> = {
	SIGNING_TOKEN_INVALID: "This signing link is not valid. Check you opened the latest link from your email.",
	SIGNING_TOKEN_EXPIRED: "This signing link has expired. Ask the sender for a new one.",
	ENVELOPE_CLOSED: "This document can no longer be signed.",
	ENVELOPE_NOT_FOUND: "This document could not be found.",
	RATE_LIMITED: "Too many attempts. Please wait a few minutes and try again.",
	TOKEN_IN_QUERY: "This link is not valid. Open the link from your email.",
	SESSION_REQUIRED: "Please reload the page and try again.",
	BAD_REQUEST: "Please check the form and try again.",
	SIGNING_OUT_OF_TURN: "Another signer has to sign first. You will get an email when it is your turn.",
	OTP_REQUIRED: "Enter the code we emailed you before signing.",
	OTP_INVALID: "That code is not right. Check the latest email and try again.",
	OTP_EXPIRED: "That code has expired. Ask for a new code.",
	OTP_LOCKED: "Too many wrong codes. Ask for a new code.",
	OTP_WAIT: "A code was sent a moment ago. Please wait before asking for another.",
	OTP_SEND_FAILED: "We could not email a code. Please try again shortly.",
	STROKES_TOO_LARGE: "Your drawn signature is too detailed. Clear it and sign again more simply.",
};

const message = (code: string) => MESSAGES[code] ?? "Something went wrong. Please try again.";

/** A receipt token as the protocol defines it (§4): two base64url segments, a 43-character signature. */
const RECEIPT_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

/**
 * The link back to the sender's site (protocol §8.2): the return URL, with `#receipt=<token>` when
 * the core issued a receipt. The receipt only ever goes in the fragment, which browsers never send to
 * a server or put in a Referer; a return URL that already has a fragment is left as it is.
 */
export function receiptReturnUrl(done: Done): string | undefined {
	const returnUrl = safeReturnUrl(done.returnUrl);
	if (!returnUrl) return undefined;
	const { receipt } = done;
	if (typeof receipt !== "string" || !RECEIPT_TOKEN.test(receipt) || returnUrl.includes("#")) return returnUrl;
	return `${returnUrl}#receipt=${receipt}`;
}

/**
 * Where the sign page redirects (303) once a sign or decline ended the ceremony with a receipt, so
 * the browser lands on the sender's site with it (§8.2). A plain visit to a closed envelope only
 * shows the link.
 */
export function ceremonyRedirect(view: SignView): string | undefined {
	if (view.kind !== "signed" && view.kind !== "declined") return undefined;
	return view.returnUrl?.includes("#receipt=") ? view.returnUrl : undefined;
}

/** Only http(s) URLs may be offered as a link back to the sender's site. */
export function safeReturnUrl(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
	} catch {
		return undefined;
	}
}

const text = (form: FormData, key: string) => {
	const value = form.get(key);
	return typeof value === "string" ? value.trim() : "";
};

function closedView(session: SessionData): SignView {
	// Signed, but the envelope is still open for the other signers (SU-FR-11).
	if (session.status === "sent" || session.status === "in_progress") {
		return { kind: "waiting", ...(session.title ? { title: session.title } : {}) };
	}
	const returnUrl = receiptReturnUrl(session);
	return {
		...(returnUrl ? { returnUrl } : {}),
		kind: "closed",
		status: session.status ?? "closed",
		...(session.title ? { title: session.title } : {}),
		...(session.pdf ? { pdf: session.pdf } : {}),
		...(session.download ? { download: session.download.url } : {}),
	};
}

/** Loads the session, and when `form` is a POST, performs the sign or decline it asks for. */
export async function handleSign(ctx: PublicRouteContext, token: string, form: FormData | null): Promise<SignView> {
	// Only a form post (a person acting) opens the envelope; a GET may be a mail scanner (T117).
	const first = await callPublicRoute<SessionData>(ctx, {
		method: "POST",
		path: "public/session",
		body: form ? { token, open: true } : { token },
	});
	if (!first.ok) return { kind: "error", code: first.error.code, message: message(first.error.code) };
	const session = first.data;
	if (session.state !== "ready") return closedView(session);
	if (!form) return { kind: "ready", session };

	const intent = text(form, "intent");
	if (intent === "otp-send" || intent === "otp-verify") {
		const verify = intent === "otp-verify";
		const result = await callPublicRoute<{ ok: true }>(ctx, {
			method: "POST",
			path: verify ? "public/otp/verify" : "public/otp/send",
			body: verify ? { token, code: text(form, "code") } : { token },
		});
		if (!result.ok)
			return { kind: "ready", session, errorCode: result.error.code, message: message(result.error.code) };
		// A verified code changes what the session offers: load it again.
		const again = verify
			? await callPublicRoute<SessionData>(ctx, { method: "POST", path: "public/session", body: { token } })
			: undefined;
		return { kind: "ready", session: again?.ok ? again.data : session, ...(verify ? {} : { otpSent: true as const }) };
	}
	if (intent === "decline") {
		const reason = text(form, "reason");
		const result = await callPublicRoute<Done>(ctx, {
			method: "POST",
			path: "public/decline",
			body: { token, ...(reason ? { reason } : {}) },
		});
		if (!result.ok)
			return { kind: "ready", session, errorCode: result.error.code, message: message(result.error.code) };
		const returnUrl = receiptReturnUrl(result.data);
		return returnUrl ? { kind: "declined", returnUrl } : { kind: "declined" };
	}

	const typedName = text(form, "typedName");
	const strokes = formStrokes(form);
	const fieldValues: Record<string, string> = {};
	const missingFields: string[] = [];
	for (const field of sessionFields(session)) {
		const value = text(form, fieldName(field.key));
		if (value) fieldValues[field.key] = value;
		else if (field.required) missingFields.push(fieldName(field.key));
	}
	const fields = [
		...missingFields,
		...(typedName ? [] : ["typedName"]),
		...(strokes && !strokes.ok ? ["signature"] : []),
		...(form.get("consent") === "on" ? [] : ["consent"]),
		...(form.get("agree") === "on" ? [] : ["agree"]),
	];
	if (fields.length > 0) {
		const code = strokes && !strokes.ok && strokes.code === "STROKES_TOO_LARGE" ? strokes.code : "BAD_REQUEST";
		return { kind: "ready", session, fields, errorCode: code, message: message(code) };
	}
	const result = await callPublicRoute<Done>(ctx, {
		method: "POST",
		path: "public/submit",
		body: {
			token,
			docSha256: session.envelope?.docSha256 ?? "",
			consentSha256: session.consent?.sha256 ?? "",
			consent: true,
			intent: true,
			signature: strokes?.ok ? { kind: "drawn", typedName, strokes: strokes.strokes } : { kind: "typed", typedName },
			fieldValues,
		},
	});
	if (!result.ok) {
		const issues = [...new Set((result.error.issues ?? []).map((i) => ISSUE_FIELD[i.path] ?? i.path))];
		return {
			kind: "ready",
			session,
			...(issues.length ? { fields: issues } : {}),
			errorCode: result.error.code,
			message: message(result.error.code),
		};
	}
	// The signed PDF is built by a job just after; the session shows its link once it is stored.
	const after = await callPublicRoute<SessionData>(ctx, { method: "POST", path: "public/session", body: { token } });
	const done = after.ok ? after.data : undefined;
	const returnUrl = receiptReturnUrl(result.data);
	return {
		kind: "signed",
		...(result.data.status && result.data.status !== "completed" ? { waiting: true as const } : {}),
		...(returnUrl ? { returnUrl } : {}),
		...(done?.download ? { download: done.download.url } : {}),
		pdf: done?.pdf ?? "pending",
	};
}

export type SignedCopyView = SignView | { kind: "unsigned" };

/**
 * The stable "get my signed copy" page (ES-US-6): the emailed signing token in the path, POSTed to
 * `public/session`, which hands a signer of a completed envelope a fresh download link each time.
 * The token is never logged or put in a URL.
 */
export async function handleSignedCopy(ctx: PublicRouteContext, token: string): Promise<SignedCopyView> {
	const result = await callPublicRoute<SessionData>(ctx, { method: "POST", path: "public/session", body: { token } });
	if (!result.ok) return { kind: "error", code: result.error.code, message: message(result.error.code) };
	return result.data.state === "ready" ? { kind: "unsigned" } : closedView(result.data);
}

export interface VerifyData {
	ok: true;
	matched: boolean;
	status?: string;
	completedAt?: string | null;
	finalHash?: string | null;
	chainVerified?: boolean | null;
}

export type VerifyView =
	| { kind: "form" }
	| { kind: "error"; code: string; message: string }
	| { kind: "result"; sha256: string; data: VerifyData };

/** A SHA-256 in hex, as `public/verify` takes it. */
export const SHA256_HEX = /^[0-9a-f]{64}$/i;

export async function handleVerify(ctx: PublicRouteContext, form: FormData | null): Promise<VerifyView> {
	if (!form) return { kind: "form" };
	const sha256 = text(form, "sha256").toLowerCase();
	if (!SHA256_HEX.test(sha256)) {
		return {
			kind: "error",
			code: "BAD_REQUEST",
			message: "Enter the 64 hexadecimal characters of the document's SHA-256.",
		};
	}
	const result = await callPublicRoute<VerifyData>(ctx, { method: "POST", path: "public/verify", body: { sha256 } });
	if (!result.ok) return { kind: "error", code: result.error.code, message: message(result.error.code) };
	return { kind: "result", sha256, data: result.data };
}
