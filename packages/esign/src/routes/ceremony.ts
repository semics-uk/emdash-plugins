/**
 * Signing ceremony public routes (ES-FR-04): `public/session`, `public/submit`, `public/decline`.
 *
 * The signer's token travels in the POST body (never the URL) and is looked up by its SHA-256
 * (`signers.tokenHash`, compared again with `verifyToken`). A wrong, unknown or already used token
 * is `SIGNING_TOKEN_INVALID`; each such failure counts against a per-IP rate limit (`rateLimit`
 * from shared), so the happy path pays nothing for it.
 *
 * Status changes go only through `transitionEnvelope`, whose guarded update is the arbiter when
 * two requests race: the loser gets `ENVELOPE_CLOSED` before it writes anything else.
 *
 * Bridge calls (R22 target ≤ 8; the hard limit is 10):
 *  - session, first view: signer + settings (2), envelope (1), snapshot (1), transition (1),
 *    audit head + create-only write (2) = 7; later views skip the last two = 5;
 *  - submit: signer + settings (2), envelope (1), audit head (1), transition (1), signer update (1),
 *    audit first event + `putMany` of the rest (2), the signed-PDF one-shot (1) = 9 (T025: the PDF
 *    is rendered by that job, not here). The head is read before the transition so the envelope's
 *    `finalHash` (which covers the chain head) is written by that one update;
 *  - session on a completed envelope: signer + settings (2), envelope (1), download-link key (1) = 4;
 *  - decline: signer (1), envelope (1), transition (1), signer update (1), audit head + 2 writes (3) = 7.
 *
 * Submit accepts only an `in_progress` envelope (R31): the first view (`sent -> in_progress`, which writes
 * `signer.viewed`) is `public/session`'s job, so no event can land between submit's head read and its
 * write and there is no rebuild path. A `sent` envelope is `SESSION_REQUIRED` and nothing is written.
 */
import { hashToken, type RateLimitStore, rateLimit, verifyToken } from "@semics-tech/shared";
import type { PluginContext, RouteHandler } from "emdash/plugin";
import { schedulePdfJob } from "../cron/pdf";
import {
	type AuditInput,
	appendAuditEvent,
	extendAuditChain,
	finalEnvelopeHash,
	readAuditHead,
	writeAuditEvents,
} from "../domain/audit";
import { type EnvelopeDoc, joinSnapshot, type SignerDoc } from "../domain/envelopes";
import {
	bindSignature,
	cleanReason,
	DEFAULT_CONSENT_VERSION,
	DEFAULT_CONSENT_WORDING,
	declinedAuditEvents,
	parseSubmit,
	type RequestPersonal,
	signedAuditEvents,
	viewedAuditEvent,
} from "../domain/signing";
import { canTransition, type EnvelopeStatus, transitionEnvelope } from "../domain/state";
import { downloadLink } from "./download";
import { badRequest, fail, obj, stores } from "./envelopes";

interface RouteInput {
	input?: unknown;
	request?: Request;
	requestMeta?: { ip?: string | null; userAgent?: string | null } | null;
}

const OPEN: readonly EnvelopeStatus[] = ["sent", "in_progress"];
const MAX_TOKEN_LENGTH = 200;
const FAILURES_PER_WINDOW = 20;
const FAILURE_WINDOW_SECONDS = 600;
const RATE_SALT = "esign-ceremony/1";

type Signed = { id: string; data: SignerDoc };

function tokenOf(input: unknown): string | null {
	const token = obj(input).token;
	return typeof token === "string" && token.length > 0 && token.length <= MAX_TOKEN_LENGTH ? token : null;
}

const personalOf = (routeCtx: RouteInput): RequestPersonal => ({
	...(routeCtx.requestMeta?.ip ? { ip: routeCtx.requestMeta.ip } : {}),
	...(routeCtx.requestMeta?.userAgent ? { ua: routeCtx.requestMeta.userAgent } : {}),
});

function tokenInUrl(request: Request | undefined): boolean {
	try {
		return request !== undefined && new URL(request.url).searchParams.has("token");
	} catch {
		return false;
	}
}

/** The failure every bad token gets, after counting it against the caller's IP (2 calls). */
async function invalidToken(ctx: PluginContext, routeCtx: RouteInput, scope: string) {
	const kv: RateLimitStore = { get: (key) => ctx.kv.get<string>(key), set: (key, value) => ctx.kv.set(key, value) };
	const limited = await rateLimit(kv, routeCtx.requestMeta?.ip ?? "unknown", Date.now(), {
		scope,
		limit: FAILURES_PER_WINDOW,
		windowSeconds: FAILURE_WINDOW_SECONDS,
		salt: RATE_SALT,
	});
	return fail(limited.ok ? "SIGNING_TOKEN_INVALID" : "RATE_LIMITED");
}

/** The signer holding `token` (one indexed query on the hash), confirmed with a constant-time compare. */
async function findSigner(ctx: PluginContext, token: string): Promise<Signed | null> {
	const { items } = await stores(ctx).signers.query({ where: { tokenHash: await hashToken(token) }, limit: 1 });
	const found = items[0];
	return found && (await verifyToken(token, found.data.tokenHash)) ? found : null;
}

const isExpired = (envelope: EnvelopeDoc, now: string) => envelope.expiresAt !== null && envelope.expiresAt <= now;

/**
 * Writes `inputs` as the next events after the chain head (head read + create-only first write +
 * `putMany`). `prebuilt` is a batch the caller already chained from a head it read; if that head
 * moved, it is rebuilt from a fresh one. Throws when two attempts both lose the race.
 */
async function writeChain(
	ctx: PluginContext,
	id: string,
	salt: string,
	inputs: readonly AuditInput[],
	prebuilt?: Awaited<ReturnType<typeof extendAuditChain>>,
) {
	const audit = stores(ctx).audit_events;
	let items = prebuilt;
	for (let attempt = 0; attempt < 2; attempt++) {
		items ??= await extendAuditChain(id, await readAuditHead(audit, id), inputs, salt);
		if (await writeAuditEvents(audit, items)) return items;
		items = undefined;
	}
	throw new Error("audit chain contention");
}

// --- public/session ---

async function session(routeCtx: RouteInput, ctx: PluginContext) {
	if (tokenInUrl(routeCtx.request)) return fail("TOKEN_IN_QUERY");
	const token = tokenOf(routeCtx.input);
	if (token === null) return invalidToken(ctx, routeCtx, "session");
	const { envelopes, snapshots } = stores(ctx);
	const [signer, settings] = await Promise.all([findSigner(ctx, token), ctx.settings.list()]);
	if (!signer) return invalidToken(ctx, routeCtx, "session");
	const envelope = await envelopes.get(signer.data.envelopeId);
	if (!envelope) return fail("ENVELOPE_NOT_FOUND");
	if (!OPEN.includes(envelope.status) || signer.data.status !== "pending") {
		const closed = { ok: true, state: "closed", status: envelope.status, title: envelope.title };
		if (envelope.status !== "completed" || signer.data.status !== "signed") return closed;
		// The signer of a completed envelope gets the signed PDF's short-lived link once it is stored.
		if (!envelope.pdfSha256) return { ...closed, pdf: "pending" };
		return { ...closed, pdf: "ready", download: await downloadLink(ctx, signer.data.envelopeId, Date.now()) };
	}
	const now = new Date().toISOString();
	if (isExpired(envelope, now)) return fail("SIGNING_TOKEN_EXPIRED");

	const chunks = envelope.snapshot ? await snapshots.getMany(envelope.snapshot.ids) : new Map();
	const text = joinSnapshot([...chunks.values()]);
	if (text === null) return fail("INTERNAL");

	let status = envelope.status;
	if (envelope.status === "sent") {
		// The first view: only the winner of the guarded update records it.
		const moved = await transitionEnvelope(envelopes, signer.data.envelopeId, "sent", "in_progress", {
			updatedAt: now,
		});
		if (moved.ok) {
			status = "in_progress";
			const event = viewedAuditEvent(now, envelope.docSha256 ?? "", personalOf(routeCtx));
			const appended = await appendAuditEvent(stores(ctx).audit_events, signer.data.envelopeId, event, {
				salt: envelope.piiSalt,
			});
			if (!appended.ok) throw new Error("audit chain contention");
		}
	}
	const setting = (key: string, fallback: string) => {
		const value = settings.find((s) => s.key === key)?.value;
		return typeof value === "string" && value.length > 0 ? value : fallback;
	};
	const { participant } = signer.data;
	return {
		ok: true,
		state: "ready",
		envelope: {
			id: signer.data.envelopeId,
			title: envelope.title,
			status,
			docSha256: envelope.docSha256,
			expiresAt: envelope.expiresAt,
		},
		signer: { name: signer.data.name, as: signer.data.as, ...(participant ? { participant } : {}) },
		snapshot: text,
		...(envelope.signerFields?.length ? { fields: envelope.signerFields } : {}),
		consent: {
			version: setting("consentVersion", DEFAULT_CONSENT_VERSION),
			wording: setting("consentWording", DEFAULT_CONSENT_WORDING),
		},
	};
}

// --- public/submit ---

async function submit(routeCtx: RouteInput, ctx: PluginContext) {
	if (tokenInUrl(routeCtx.request)) return fail("TOKEN_IN_QUERY");
	const token = tokenOf(routeCtx.input);
	if (token === null) return invalidToken(ctx, routeCtx, "submit");
	const fields = parseSubmit(routeCtx.input);
	if (!fields.ok) return badRequest(fields.error);
	const { envelopes, signers, audit_events } = stores(ctx);
	const [signer, consentVersion] = await Promise.all([
		findSigner(ctx, token),
		ctx.settings.get<string>("consentVersion"),
	]);
	if (!signer || signer.data.status !== "pending") return invalidToken(ctx, routeCtx, "submit");
	const envelopeId = signer.data.envelopeId;
	const envelope = await envelopes.get(envelopeId);
	if (!envelope) return fail("ENVELOPE_NOT_FOUND");
	if (envelope.status === "sent") return fail("SESSION_REQUIRED");
	if (envelope.status !== "in_progress") return fail("ENVELOPE_CLOSED");
	const now = new Date().toISOString();
	if (isExpired(envelope, now)) return fail("SIGNING_TOKEN_EXPIRED");
	// The signature binds to the document the signer saw; the snapshot is immutable after send.
	if (envelope.docSha256 === null || fields.value.docSha256 !== envelope.docSha256) {
		return badRequest([{ path: "docSha256", code: "DOC_CHANGED" }]);
	}

	// The signer fills in exactly the fields the sender declared; required ones must have a value.
	const declared = envelope.signerFields ?? [];
	const given = fields.value.fieldValues;
	const fieldIssues = [
		...Object.keys(given)
			.filter((k) => !declared.some((f) => f.key === k))
			.map((k) => ({ path: `fieldValues.${k}`, code: "INVALID_FIELDS" })),
		...declared
			.filter((f) => f.required && (given[f.key] ?? "").trim() === "")
			.map((f) => ({ path: `fieldValues.${f.key}`, code: "INVALID_FIELDS" })),
	];
	if (fieldIssues.length > 0) return badRequest(fieldIssues);

	const version =
		typeof consentVersion === "string" && consentVersion.length > 0 ? consentVersion : DEFAULT_CONSENT_VERSION;
	const signature = await bindSignature(envelope.docSha256, fields.value.signature);
	const who = personalOf(routeCtx);
	const inputs = signedAuditEvents({
		at: now,
		docSha256: envelope.docSha256,
		consentVersion: version,
		signature,
		signerName: signer.data.name,
		who,
	});
	const head = await readAuditHead(audit_events, envelopeId);
	const planned = await extendAuditChain(envelopeId, head, inputs, envelope.piiSalt);
	const finalHash = await finalEnvelopeHash(envelope.docSha256, planned.at(-1)?.data.hash ?? "");

	const moved = await transitionEnvelope(envelopes, envelopeId, envelope.status, "completed", {
		completedAt: now,
		finalHash,
		updatedAt: now,
	});
	if (!moved.ok) return fail("ENVELOPE_CLOSED");
	await signers.updateIf(signer.id, {
		where: { status: "pending" },
		set: {
			status: "signed",
			signature,
			consentAt: now,
			consentVersion: version,
			signedAt: now,
			fieldValues: fields.value.fieldValues,
			...who,
		},
	});
	// Only `in_progress` envelopes get here and the transition above is the single arbiter, so the head
	// cannot have moved: one create-only write, no rebuild.
	if (!(await writeAuditEvents(audit_events, planned))) throw new Error("audit chain contention");
	// The signed PDF is rendered by a one-shot job on the next cron tick (T025, cron/pdf.ts).
	await schedulePdfJob(ctx.cron, envelopeId, Date.parse(now));
	return {
		ok: true,
		status: "completed",
		completedAt: now,
		...(envelope.returnUrl ? { returnUrl: envelope.returnUrl } : {}),
	};
}

// --- public/decline ---

async function decline(routeCtx: RouteInput, ctx: PluginContext) {
	if (tokenInUrl(routeCtx.request)) return fail("TOKEN_IN_QUERY");
	const token = tokenOf(routeCtx.input);
	if (token === null) return invalidToken(ctx, routeCtx, "decline");
	const reason = cleanReason(obj(routeCtx.input).reason);
	if (reason === null) return badRequest([{ path: "reason", code: "INVALID_INPUT" }]);
	const { envelopes, signers } = stores(ctx);
	const signer = await findSigner(ctx, token);
	if (!signer || signer.data.status !== "pending") return invalidToken(ctx, routeCtx, "decline");
	const envelopeId = signer.data.envelopeId;
	const envelope = await envelopes.get(envelopeId);
	if (!envelope) return fail("ENVELOPE_NOT_FOUND");
	if (!canTransition(envelope.status, "declined")) return fail("ENVELOPE_CLOSED");
	const now = new Date().toISOString();
	if (isExpired(envelope, now)) return fail("SIGNING_TOKEN_EXPIRED");

	const moved = await transitionEnvelope(envelopes, envelopeId, envelope.status, "declined", { updatedAt: now });
	if (!moved.ok) return fail("ENVELOPE_CLOSED");
	const who = personalOf(routeCtx);
	await signers.updateIf(signer.id, {
		where: { status: "pending" },
		set: { status: "declined", declinedAt: now, ...(reason === undefined ? {} : { declineReason: reason }), ...who },
	});
	await writeChain(
		ctx,
		envelopeId,
		envelope.piiSalt,
		declinedAuditEvents({ at: now, docSha256: envelope.docSha256, hasReason: reason !== undefined, who }),
	);
	return { ok: true, status: "declined", ...(envelope.returnUrl ? { returnUrl: envelope.returnUrl } : {}) };
}

const wrap =
	(handler: (routeCtx: RouteInput, ctx: PluginContext) => Promise<unknown>): RouteHandler =>
	(routeCtx, ctx) =>
		handler(routeCtx as unknown as RouteInput, ctx);

export const CEREMONY_HANDLERS: Record<string, RouteHandler> = {
	"public/session": wrap(session),
	"public/submit": wrap(submit),
	"public/decline": wrap(decline),
};
