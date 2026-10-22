/**
 * Signing ceremony public routes (ES-FR-04): `public/session`, `public/submit`, `public/decline`.
 *
 * The signer's token travels in the POST body (never the URL) and is looked up by its SHA-256
 * (`signers.tokenHash`, compared again with `verifyToken`). A wrong, unknown or already used token
 * is `SIGNING_TOKEN_INVALID`; each such failure counts against one per-IP limit shared by the three
 * routes (`rateLimit` from shared, 20 per 10 minutes). `public/session`, which every ceremony opens
 * with, reads that counter before its lookup and refuses an IP over the limit without looking the
 * token up (R29, T117). Submit (9 calls) and decline only count; a 256-bit token makes guessing moot
 * either way.
 *
 * The first view (`sent -> in_progress`, `signer.viewed`) is recorded only when the caller asks with
 * `open: true`, which the sign page sends with its first POST (sign or decline), never on a GET: mail
 * scanners prefetch emailed links, so a GET is no evidence that the signer opened the document (T117).
 *
 * Settings are read only as far as the envelope needs (T062 review, T117): the consent wording by its
 * `consent` prefix, the integration master key (a secret) only for an integration's envelope, so a
 * missing or changed `EMDASH_ENCRYPTION_KEY` never blocks a plain signature.
 *
 * Status changes go only through `transitionEnvelope`, whose guarded update is the arbiter when
 * two requests race: the loser gets `ENVELOPE_CLOSED` before it writes anything else.
 *
 * Bridge calls (R22 target ≤ 8; the hard limit is 10):
 *  - session: limiter read (1), signer (1), envelope (1), snapshot and consent settings (2) = 5; the first
 *    view (`open`) adds the transition (1) and the audit head + create-only write (2) = 8 (with several
 *    signers, T090, each signer's guarded `viewedAt` write is +1: 9 for the view that also opens); a wrong token
 *    is the limiter read, the signer and copy-token lookups and the counter write = 4; a completed
 *    envelope is limiter, signer, envelope, download-link key (+ the master key for an integration) = 4-5;
 *  - submit: signer (1), envelope (1), settings (1), audit head (1), transition (1), signer update (1),
 *    audit first event + `putMany` of the rest (2), the signed-PDF one-shot (1) = 9 (T025: the PDF
 *    is rendered by that job, not here). The head is read before the transition so the envelope's
 *    `finalHash` (which covers the chain head) is written by that one update. An envelope with several
 *    signers (T090) stops after the settings read: Free refuses it (`ENVELOPE_CLOSED`, nothing written),
 *    a Pro build hands the validated signature to its routing step (`ceremonyHandlers`);
 *  - decline: signer (1), envelope (1), transition (1), signer update (1), audit head + 2 writes (3) = 7,
 *    plus the master key (1) for an integration's envelope = 8.
 *
 * Submit, decline and a closed session answer an integration's envelope with its `returnUrl` and
 * signed receipt (T062, protocol §8.2), minted from that one master-key read.
 *
 * Submit accepts only an `in_progress` envelope (R31): the first view is `public/session`'s job, so no
 * event can land between submit's head read and its write and there is no rebuild path. A `sent`
 * envelope is `SESSION_REQUIRED` and nothing is written.
 */
import { hashToken, type RateLimitStore, rateLimit, sha256Hex, toIso, verifyToken } from "@semics-tech/shared";
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
import { mintReceipt } from "./integration";

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
/** One counter for the three routes, so a failure anywhere counts toward the session gate. */
const RATE_SCOPE = "ceremony";

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

/**
 * The caller's per-IP failure counter. `blocked()` reads it (1 call) and gates the session lookup;
 * `fail()` answers a bad token after counting it (1 more call after `blocked()`, else 2), or with
 * `RATE_LIMITED` once over the limit. The counter is read at most once per request.
 */
function failureLimiter(ctx: PluginContext, routeCtx: RouteInput) {
	const reads = new Map<string, Promise<string | null | undefined>>();
	let pending: { key: string; value: string } | undefined;
	const store: RateLimitStore = {
		get: (key) => {
			let read = reads.get(key);
			if (!read) {
				read = ctx.kv.get<string>(key);
				reads.set(key, read);
			}
			return read;
		},
		// Deferred: only a failure writes the counter.
		set: async (key, value) => {
			pending = { key, value };
		},
	};
	const now = Date.now();
	const check = () =>
		rateLimit(store, routeCtx.requestMeta?.ip ?? "unknown", now, {
			scope: RATE_SCOPE,
			limit: FAILURES_PER_WINDOW,
			windowSeconds: FAILURE_WINDOW_SECONDS,
			salt: RATE_SALT,
		});
	return {
		async blocked(): Promise<boolean> {
			return !(await check()).ok;
		},
		async fail() {
			const limited = await check();
			if (limited.ok && pending) await ctx.kv.set(pending.key, pending.value);
			return fail(limited.ok ? "SIGNING_TOKEN_INVALID" : "RATE_LIMITED");
		},
	};
}

/** The signer holding `token` (one indexed query on the hash), confirmed with a constant-time compare. */
async function findSigner(ctx: PluginContext, token: string): Promise<Signed | null> {
	const { items } = await stores(ctx).signers.query({ where: { tokenHash: await hashToken(token) }, limit: 1 });
	const found = items[0];
	return found && (await verifyToken(token, found.data.tokenHash)) ? found : null;
}

/** The signer whose signed-copy token this is (R36): only `public/session` accepts it, and only once completed. */
async function findCopySigner(ctx: PluginContext, token: string): Promise<Signed | null> {
	const { items } = await stores(ctx).signers.query({ where: { copyTokenHash: await hashToken(token) }, limit: 1 });
	const found = items[0];
	return found?.data.copyTokenHash && (await verifyToken(token, found.data.copyTokenHash)) ? found : null;
}

/** Whether answering for this envelope needs the integration master key (its receipt, T062). */
const needsMasterKey = (envelope: EnvelopeDoc) => Boolean(envelope.returnUrl && envelope.clientId);

/** The master key, read (and decrypted) only for an integration's envelope: 1 call then, none otherwise. */
const masterKeyFor = (ctx: PluginContext, envelope: EnvelopeDoc): Promise<unknown> =>
	needsMasterKey(envelope) ? ctx.settings.get("integrationMasterKey") : Promise.resolve(undefined);

/**
 * Where the ceremony returns the signer, with the receipt for an integration's envelope (protocol
 * §8.2): `returnUrl`, plus `receipt` when the envelope is terminal and an integration created it. The
 * page appends it as `#receipt=`; it never goes in a query string. No bridge calls.
 */
async function returnTo(id: string, envelope: EnvelopeDoc, masterKey: unknown) {
	if (!envelope.returnUrl) return {};
	const receipt = await mintReceipt(id, envelope, masterKey);
	return { returnUrl: envelope.returnUrl, ...(receipt ? { receipt } : {}) };
}

const settingOf = (settings: ReadonlyArray<{ key: string; value: unknown }>, key: string) =>
	settings.find((s) => s.key === key)?.value;

/**
 * The consent version and wording (with the wording's SHA-256) in one call: by the `consent` prefix,
 * which decrypts nothing, or, with `withMasterKey` for an integration's envelope, every setting.
 */
async function consentSettings(ctx: PluginContext, withMasterKey: boolean) {
	const settings = await (withMasterKey ? ctx.settings.list() : ctx.settings.list("consent"));
	const setting = (key: string, fallback: string) => {
		const value = settingOf(settings, key);
		return typeof value === "string" && value.length > 0 ? value : fallback;
	};
	const wording = setting("consentWording", DEFAULT_CONSENT_WORDING);
	return {
		version: setting("consentVersion", DEFAULT_CONSENT_VERSION),
		wording,
		sha256: await sha256Hex(wording),
		masterKey: settingOf(settings, "integrationMasterKey"),
	};
}

const isExpired = (envelope: EnvelopeDoc, now: string) => envelope.expiresAt !== null && envelope.expiresAt <= now;

/** The signer's order in an envelope with several signers (T090), else undefined (one signer: events as before). */
const orderOf = (envelope: EnvelopeDoc, signer: SignerDoc) =>
	envelope.signerIds.length > 1 ? signer.order : undefined;

/**
 * A validated signature in an envelope with several signers (T090), for the edition that routes them
 * (`ceremonyHandlers(step)`, `src/seams.ts`). `set` is the signer's signed record (status, signature,
 * consent, entered values, ip, ua), as one signer's submit stores it.
 */
export interface SeveralSigners {
	envelopeId: string;
	envelope: EnvelopeDoc;
	signer: Signed;
	set: Partial<SignerDoc>;
	now: string;
}

export type SeveralSignersStep = (ctx: PluginContext, args: SeveralSigners) => Promise<unknown>;

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
	const limiter = failureLimiter(ctx, routeCtx);
	const token = tokenOf(routeCtx.input);
	if (token === null) return limiter.fail();
	// R29: an IP over the failure limit is refused before its token is looked up.
	if (await limiter.blocked()) return fail("RATE_LIMITED");
	const open = obj(routeCtx.input).open === true;
	const { envelopes, snapshots } = stores(ctx);
	const found = await findSigner(ctx, token);
	const viaCopy = found ? null : await findCopySigner(ctx, token);
	const signer = found ?? viaCopy;
	if (!signer) return limiter.fail();
	const envelope = await envelopes.get(signer.data.envelopeId);
	if (!envelope) return fail("ENVELOPE_NOT_FOUND");
	// A copy token only ever shows the completed envelope's closed state and download link.
	if (viaCopy && envelope.status !== "completed") return limiter.fail();
	if (!OPEN.includes(envelope.status) || signer.data.status !== "pending") {
		const closed = {
			ok: true,
			state: "closed",
			status: envelope.status,
			title: envelope.title,
			...(viaCopy ? {} : await returnTo(signer.data.envelopeId, envelope, await masterKeyFor(ctx, envelope))),
		};
		if (envelope.status !== "completed" || signer.data.status !== "signed") return closed;
		// The signer of a completed envelope gets the signed PDF's short-lived link once it is stored.
		if (!envelope.pdfSha256) return { ...closed, pdf: "pending" };
		return { ...closed, pdf: "ready", download: await downloadLink(ctx, signer.data.envelopeId, Date.now()) };
	}
	const now = toIso();
	if (isExpired(envelope, now)) return fail("SIGNING_TOKEN_EXPIRED");

	const [chunks, consent] = await Promise.all([
		envelope.snapshot ? snapshots.getMany(envelope.snapshot.ids) : Promise.resolve(new Map()),
		consentSettings(ctx, false),
	]);
	const text = joinSnapshot([...chunks.values()]);
	if (text === null) return fail("INTERNAL");

	let status = envelope.status;
	const order = orderOf(envelope, signer.data);
	if (open) {
		// The first view: only the winner of the guarded update records it.
		let first = false;
		if (envelope.status === "sent") {
			first = (await transitionEnvelope(envelopes, signer.data.envelopeId, "sent", "in_progress", { updatedAt: now }))
				.ok;
			if (first) status = "in_progress";
		}
		// Several signers (T090): each signer's own first view, once, guarded on their signer document (+1 call).
		if (order !== undefined) {
			first = (await stores(ctx).signers.updateIf(signer.id, { where: { viewedAt: null }, set: { viewedAt: now } }))
				.applied;
		}
		if (first) {
			const event = viewedAuditEvent(now, envelope.docSha256 ?? "", personalOf(routeCtx), order);
			const appended = await appendAuditEvent(stores(ctx).audit_events, signer.data.envelopeId, event, {
				salt: envelope.piiSalt,
			});
			if (!appended.ok) throw new Error("audit chain contention");
		}
	}
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
		consent: { version: consent.version, wording: consent.wording, sha256: consent.sha256 },
	};
}

// --- public/submit ---

async function submit(routeCtx: RouteInput, ctx: PluginContext, several?: SeveralSignersStep) {
	if (tokenInUrl(routeCtx.request)) return fail("TOKEN_IN_QUERY");
	const limiter = failureLimiter(ctx, routeCtx);
	const token = tokenOf(routeCtx.input);
	if (token === null) return limiter.fail();
	const fields = parseSubmit(routeCtx.input);
	if (!fields.ok) return badRequest(fields.error);
	const { envelopes, signers, audit_events } = stores(ctx);
	const signer = await findSigner(ctx, token);
	if (!signer || signer.data.status !== "pending") return limiter.fail();
	const envelopeId = signer.data.envelopeId;
	const envelope = await envelopes.get(envelopeId);
	if (!envelope) return fail("ENVELOPE_NOT_FOUND");
	if (envelope.status === "sent") return fail("SESSION_REQUIRED");
	if (envelope.status !== "in_progress") return fail("ENVELOPE_CLOSED");
	const now = toIso();
	if (isExpired(envelope, now)) return fail("SIGNING_TOKEN_EXPIRED");
	// The signature binds to the document the signer saw; the snapshot is immutable after send.
	if (envelope.docSha256 === null || fields.value.docSha256 !== envelope.docSha256) {
		return badRequest([{ path: "docSha256", code: "DOC_CHANGED" }]);
	}
	// The consent recorded is the wording the signer was shown: if it has changed since, they see it again.
	const consent = await consentSettings(ctx, needsMasterKey(envelope));
	if (fields.value.consentSha256 !== consent.sha256) {
		return badRequest([{ path: "consentSha256", code: "CONSENT_CHANGED" }]);
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

	const signature = await bindSignature(envelope.docSha256, fields.value.signature, {
		fieldValues: given,
		salt: envelope.piiSalt,
	});
	const who = personalOf(routeCtx);
	const set: Partial<SignerDoc> = {
		status: "signed",
		signature,
		consentAt: now,
		consentVersion: consent.version,
		consentSha256: consent.sha256,
		signedAt: now,
		fieldValues: given,
		...who,
	};
	// Several signers (T090, a Pro build's routing): Free never completes such an envelope, so one left by a
	// downgrade stays as it is until a Pro build signs it.
	if (envelope.signerIds.length > 1) {
		return several ? several(ctx, { envelopeId, envelope, signer, set, now }) : fail("ENVELOPE_CLOSED");
	}
	const inputs = signedAuditEvents({
		at: now,
		docSha256: envelope.docSha256,
		consentVersion: consent.version,
		consentSha256: consent.sha256,
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
	await signers.updateIf(signer.id, { where: { status: "pending" }, set });
	// Only `in_progress` envelopes get here and the transition above is the single arbiter, so the head
	// cannot have moved: one create-only write, no rebuild.
	if (!(await writeAuditEvents(audit_events, planned))) throw new Error("audit chain contention");
	// The signed PDF is rendered by a one-shot job on the next cron tick (T025, cron/pdf.ts).
	await schedulePdfJob(ctx.cron, envelopeId, Date.parse(now));
	return {
		ok: true,
		status: "completed",
		completedAt: now,
		...(await returnTo(envelopeId, moved.value, consent.masterKey)),
	};
}

// --- public/decline ---

async function decline(routeCtx: RouteInput, ctx: PluginContext) {
	if (tokenInUrl(routeCtx.request)) return fail("TOKEN_IN_QUERY");
	const limiter = failureLimiter(ctx, routeCtx);
	const token = tokenOf(routeCtx.input);
	if (token === null) return limiter.fail();
	const reason = cleanReason(obj(routeCtx.input).reason);
	if (reason === null) return badRequest([{ path: "reason", code: "INVALID_INPUT" }]);
	const { envelopes, signers } = stores(ctx);
	const signer = await findSigner(ctx, token);
	if (!signer || signer.data.status !== "pending") return limiter.fail();
	const envelopeId = signer.data.envelopeId;
	const envelope = await envelopes.get(envelopeId);
	if (!envelope) return fail("ENVELOPE_NOT_FOUND");
	if (!canTransition(envelope.status, "declined")) return fail("ENVELOPE_CLOSED");
	const now = toIso();
	if (isExpired(envelope, now)) return fail("SIGNING_TOKEN_EXPIRED");

	const moved = await transitionEnvelope(envelopes, envelopeId, envelope.status, "declined", {
		closedAt: now,
		updatedAt: now,
	});
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
		declinedAuditEvents({
			at: now,
			docSha256: envelope.docSha256,
			hasReason: reason !== undefined,
			who,
			order: orderOf(envelope, signer.data),
		}),
	);
	return {
		ok: true,
		status: "declined",
		...(await returnTo(envelopeId, moved.value, await masterKeyFor(ctx, moved.value))),
	};
}

const wrap =
	(handler: (routeCtx: RouteInput, ctx: PluginContext) => Promise<unknown>): RouteHandler =>
	(routeCtx, ctx) =>
		handler(routeCtx as unknown as RouteInput, ctx);

/** The ceremony routes; `several` signs an envelope with several signers (a Pro build's routing, T090). */
export const ceremonyHandlers = (several?: SeveralSignersStep): Record<string, RouteHandler> => ({
	"public/session": wrap(session),
	"public/submit": wrap((routeCtx, ctx) => submit(routeCtx, ctx, several)),
	"public/decline": wrap(decline),
});

export const CEREMONY_HANDLERS = ceremonyHandlers();
