import { callPublicRoute, type PublicRouteContext } from "./call.ts";

/**
 * The signing page's logic (SU-FR-01), kept out of the `.astro` file so it is testable. The token is
 * the page path; here it only ever goes into POST bodies. `public/session` is always called first
 * (it records the first view: R31), and a submit is bound to the document hash that session returned.
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
	consent?: { version: string; wording: string };
}

export type SignView =
	| { kind: "error"; code: string; message: string }
	| {
			kind: "ready";
			session: SessionData;
			/** Form fields to fix (`typedName`, `consent`, `agree`). */
			fields?: string[];
			errorCode?: string;
			message?: string;
	  }
	| { kind: "closed"; status: string; title?: string; pdf?: "pending" | "ready"; download?: string }
	| { kind: "signed"; returnUrl?: string; download?: string; pdf?: "pending" | "ready" }
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
};

const message = (code: string) => MESSAGES[code] ?? "Something went wrong. Please try again.";

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
	return {
		kind: "closed",
		status: session.status ?? "closed",
		...(session.title ? { title: session.title } : {}),
		...(session.pdf ? { pdf: session.pdf } : {}),
		...(session.download ? { download: session.download.url } : {}),
	};
}

/** Loads the session, and when `form` is a POST, performs the sign or decline it asks for. */
export async function handleSign(ctx: PublicRouteContext, token: string, form: FormData | null): Promise<SignView> {
	const first = await callPublicRoute<SessionData>(ctx, { method: "POST", path: "public/session", body: { token } });
	if (!first.ok) return { kind: "error", code: first.error.code, message: message(first.error.code) };
	const session = first.data;
	if (session.state !== "ready") return closedView(session);
	if (!form) return { kind: "ready", session };

	if (text(form, "intent") === "decline") {
		const reason = text(form, "reason");
		const result = await callPublicRoute<{ returnUrl?: string }>(ctx, {
			method: "POST",
			path: "public/decline",
			body: { token, ...(reason ? { reason } : {}) },
		});
		if (!result.ok) return { kind: "ready", session, errorCode: result.error.code, message: message(result.error.code) };
		const returnUrl = safeReturnUrl(result.data.returnUrl);
		return returnUrl ? { kind: "declined", returnUrl } : { kind: "declined" };
	}

	const typedName = text(form, "typedName");
	const fields = [
		...(typedName ? [] : ["typedName"]),
		...(form.get("consent") === "on" ? [] : ["consent"]),
		...(form.get("agree") === "on" ? [] : ["agree"]),
	];
	if (fields.length > 0) {
		return { kind: "ready", session, fields, errorCode: "BAD_REQUEST", message: message("BAD_REQUEST") };
	}
	const result = await callPublicRoute<{ returnUrl?: string }>(ctx, {
		method: "POST",
		path: "public/submit",
		body: {
			token,
			docSha256: session.envelope?.docSha256 ?? "",
			consent: true,
			intent: true,
			signature: { kind: "typed", typedName },
			fieldValues: {},
		},
	});
	if (!result.ok) {
		const issues = (result.error.issues ?? []).map((i) => i.path);
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
	const returnUrl = safeReturnUrl(result.data.returnUrl);
	return {
		kind: "signed",
		...(returnUrl ? { returnUrl } : {}),
		...(done?.download ? { download: done.download.url } : {}),
		pdf: done?.pdf ?? "pending",
	};
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
		return { kind: "error", code: "BAD_REQUEST", message: "Enter the 64 hexadecimal characters of the document's SHA-256." };
	}
	const result = await callPublicRoute<VerifyData>(ctx, { method: "POST", path: "public/verify", body: { sha256 } });
	if (!result.ok) return { kind: "error", code: result.error.code, message: message(result.error.code) };
	return { kind: "result", sha256, data: result.data };
}
