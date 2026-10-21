/**
 * Envelope routes (ES-FR-02, ES-FR-03): thin adapters over `domain/envelopes` and `domain/state`.
 *
 * Private (admin): `envelopes/create` (draft), `envelopes/send` (freeze + signer), `envelopes/get`,
 * `envelopes/list`. Public: `public/envelopes/from-intent` (verify an `esign-intent/1` token, then
 * create and send, or return the envelope for its `(cid, ref)`; protocol §8.1).
 *
 * Every status change goes through `transitionEnvelope` (or, for an envelope created already sent,
 * through `sendEnvelope`'s `draft → sent` check), so the table in `domain/state.ts` is the one
 * source of truth for routes and cron jobs. Each handler stays at ≤ 8 bridge calls (R22), except
 * from-intent at 9 with email delivery (still inside the hard limit of 10; see below). Create and send write the
 * envelope's opening `audit_events` (domain/audit.ts).
 */
import {
	deriveClientSecret,
	type EsignClient,
	generateToken,
	hashToken,
	type RandomBytes,
	toRouteError,
	verifyIntentToken,
} from "@semics-tech/shared";
import type { PluginContext, RouteHandler, SandboxedPlugin } from "emdash/plugin";
import { scheduleIntentFinish } from "../cron/intent-finish";
import { type AuditEventDoc, type AuditInput, appendAuditEvent, initialAuditEvents, newPiiSalt } from "../domain/audit";
import {
	buildDraft,
	createdAuditEvent,
	draftFromIntent,
	type EnvelopeDoc,
	envelopeIdForRef,
	existingForRef,
	joinSnapshot,
	parseDraftInput,
	pickTemplateVersion,
	type SignerDoc,
	type SnapshotChunkDoc,
	sendEnvelope,
	sentAuditEvent,
} from "../domain/envelopes";
import { masterKeyBytes } from "../domain/master-key";
import type { ArtifactChunkDoc } from "../domain/pdf";
import { canTransition, isEnvelopeStatus, transitionEnvelope } from "../domain/state";
import { type TemplateDoc, versionDocId } from "../domain/templates";
import { outboxReport, queueInvitation } from "../emails/outbox";
import { downloadLink } from "./download";

type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (routeCtx: { input?: unknown }, ctx: PluginContext) => Promise<unknown>;

// --- storage access (the slice of StorageCollection each handler uses) ---

export interface Collection<T> {
	get(id: string): Promise<T | null>;
	getMany(ids: string[]): Promise<Map<string, T>>;
	put(id: string, data: T): Promise<void>;
	putMany(items: Array<{ id: string; data: T }>): Promise<void>;
	compareAndSet(id: string, expectedRevision: string | null, data: T): Promise<{ applied: boolean }>;
	updateIf(
		id: string,
		args: { where: Record<string, unknown>; set?: Partial<T> },
	): Promise<{ applied: true; data: T } | { applied: false }>;
	query(o: {
		where?: Record<string, unknown>;
		orderBy?: Record<string, "asc" | "desc">;
		limit?: number;
	}): Promise<{ items: Array<{ id: string; data: T }> }>;
}

interface ClientDoc {
	clientId: string;
	revokedAt?: string | null;
	returnUrlAllowlist?: unknown;
}

interface NonceDoc {
	nonce: string;
	cid: string;
	expiresAt: string;
}

export interface Stores {
	envelopes: Collection<EnvelopeDoc>;
	signers: Collection<SignerDoc>;
	snapshots: Collection<SnapshotChunkDoc>;
	templates: Collection<TemplateDoc>;
	clients: Collection<ClientDoc>;
	nonces: Collection<NonceDoc>;
	audit_events: Collection<AuditEventDoc>;
	artifacts: Collection<ArtifactChunkDoc>;
}

export const stores = (ctx: PluginContext) => ctx.storage as unknown as Stores;

// --- helpers ---

export const obj = (input: unknown): Record<string, unknown> =>
	typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};

export const badRequest = (issues?: readonly { path: string; code: string }[]) => ({
	...toRouteError("BAD_REQUEST").body,
	...(issues ? { issues } : {}),
});

export const fail = (code: Parameters<typeof toRouteError>[0]) => toRouteError(code).body;

function idOf(input: unknown): string | null {
	const id = obj(input).id;
	return typeof id === "string" && id.length > 0 && id.length <= 200 ? id : null;
}

const DEFAULT_EXPIRY_DAYS = 30;

export function expiryDays(value: unknown): number {
	return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 365
		? (value as number)
		: DEFAULT_EXPIRY_DAYS;
}

/** D1 rejects a duplicate on a unique index with this message (R26). */
export function isUniqueViolation(error: unknown): boolean {
	return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

const TOKEN_ATTEMPTS = 3;

/**
 * Runs `write(tokenHash)` and, if the store rejects the hash as a duplicate (unique `tokenHash`,
 * R26), retries with a fresh token. Returns the token whose hash was stored.
 */
async function withUniqueToken<T>(
	token: string,
	random: RandomBytes | undefined,
	write: (tokenHash: string) => Promise<T>,
): Promise<{ token: string; value: T }> {
	let current = token;
	for (let attempt = 1; ; attempt++) {
		try {
			return { token: current, value: await write(await hashToken(current)) };
		} catch (error) {
			if (!isUniqueViolation(error) || attempt >= TOKEN_ATTEMPTS) throw error;
			current = generateToken(random);
		}
	}
}

export interface SignerStore {
	put(id: string, data: SignerDoc): Promise<void>;
}

/**
 * Stores the signer with `tokenHash = SHA-256(token)` and returns the token, which is never stored.
 * On a duplicate hash it retries with a fresh token.
 */
export async function insertSigner(
	signers: SignerStore,
	signer: { id: string; data: SignerDoc },
	token: string,
	random?: RandomBytes,
): Promise<string> {
	const { token: stored } = await withUniqueToken(token, random, (tokenHash) =>
		signers.put(signer.id, { ...signer.data, tokenHash }),
	);
	return stored;
}

// The audit salt never leaves storage.
const view = (id: string, { piiSalt: _p, ...doc }: EnvelopeDoc) => ({ id, ...doc });
const summary = (id: string, { snapshot: _s, fieldValues: _f, piiSalt: _p, ...rest }: EnvelopeDoc) => ({
	id,
	...rest,
});

/** Appends to an existing chain; an append that loses every race fails the route (500). */
async function appendAudit(ctx: PluginContext, id: string, envelope: EnvelopeDoc, input: AuditInput) {
	const appended = await appendAuditEvent(stores(ctx).audit_events, id, input, { salt: envelope.piiSalt });
	if (!appended.ok) throw new Error("audit chain contention");
}

// --- private routes ---

async function create(routeCtx: { input?: unknown }, ctx: PluginContext) {
	const fields = parseDraftInput(routeCtx.input);
	if (!fields.ok) return badRequest(fields.error);
	const { templateId, templateVersion } = fields.value;
	const { templates, envelopes, audit_events } = stores(ctx);
	const docs = await templates.getMany(
		templateVersion === undefined ? [templateId] : [templateId, versionDocId(templateId, templateVersion)],
	);
	const template = pickTemplateVersion(
		docs.get(templateId),
		templateVersion === undefined ? undefined : docs.get(versionDocId(templateId, templateVersion)),
		templateVersion,
	);
	if (!template.ok) return fail("TEMPLATE_NOT_FOUND");
	const piiSalt = newPiiSalt();
	const draft = buildDraft(fields.value, template.value, { now: new Date().toISOString(), piiSalt });
	if (!draft.ok) return badRequest(draft.error);
	const id = crypto.randomUUID();
	await envelopes.put(id, draft.value);
	// A fresh UUID: nobody else can be writing this chain yet.
	await audit_events.putMany(await initialAuditEvents(id, [createdAuditEvent(draft.value, "admin")], piiSalt));
	return { ok: true, envelope: view(id, draft.value) };
}

async function send(routeCtx: { input?: unknown }, ctx: PluginContext) {
	const id = idOf(routeCtx.input);
	if (!id) return badRequest();
	const { envelopes, templates, snapshots, signers } = stores(ctx);
	const envelope = await envelopes.get(id);
	if (!envelope) return fail("ENVELOPE_NOT_FOUND");
	if (!canTransition(envelope.status, "sent")) return fail("ENVELOPE_CLOSED");
	const { templateId, templateVersion } = envelope;
	const [docs, all] = await Promise.all([
		templates.getMany([templateId, versionDocId(templateId, templateVersion)]),
		ctx.settings.list(),
	]);
	const settings = Object.fromEntries(all.map((s) => [s.key, s.value]));
	// The head must still be active; the content comes from the pinned version document.
	const template = pickTemplateVersion(
		docs.get(templateId),
		docs.get(versionDocId(templateId, templateVersion)),
		templateVersion,
	);
	if (!template.ok) return fail("TEMPLATE_NOT_FOUND");
	const token = generateToken();
	const sent = await sendEnvelope(id, envelope, template.value, {
		now: new Date().toISOString(),
		tokenHash: await hashToken(token),
		expiryDays: expiryDays(settings.expiryDays),
	});
	if (!sent.ok) return Array.isArray(sent.error) ? badRequest(sent.error) : fail("ENVELOPE_CLOSED");
	await snapshots.putMany(sent.value.chunks);
	const moved = await transitionEnvelope(envelopes, id, "draft", "sent", sent.value.envelope);
	if (!moved.ok) return fail("ENVELOPE_CLOSED");
	// The token goes out in the invitation email (T027); it is never returned.
	const stored = await insertSigner(signers, sent.value.signer, token);
	await queueInvitation(ctx, {
		signerId: sent.value.signer.id,
		envelope: moved.value,
		token: stored,
		senderSetting: settings.senderName,
		now: Date.now(),
	});
	// Only the winner of the guarded draft → sent update gets here, so at most one `sent` event.
	await appendAudit(ctx, id, moved.value, sentAuditEvent(moved.value, "admin"));
	return { ok: true, envelope: view(id, moved.value) };
}

async function get(routeCtx: { input?: unknown }, ctx: PluginContext) {
	const id = idOf(routeCtx.input);
	if (!id) return badRequest();
	const { envelopes, snapshots, signers } = stores(ctx);
	const envelope = await envelopes.get(id);
	if (!envelope) return fail("ENVELOPE_NOT_FOUND");
	const [chunks, people] = await Promise.all([
		envelope.snapshot ? snapshots.getMany(envelope.snapshot.ids) : Promise.resolve(new Map<string, SnapshotChunkDoc>()),
		envelope.signerIds.length > 0 ? signers.getMany(envelope.signerIds) : Promise.resolve(new Map<string, SignerDoc>()),
	]);
	// The signed PDF's short-lived download link (T025), once the PDF job has stored it.
	const download = envelope.pdfSha256 ? await downloadLink(ctx, id, Date.now()) : null;
	return {
		ok: true,
		envelope: view(id, envelope),
		download,
		snapshot: envelope.snapshot ? joinSnapshot([...chunks.values()]) : null,
		signers: [...people].map(([signerId, s]) => ({
			id: signerId,
			order: s.order,
			name: s.name,
			email: s.email,
			status: s.status,
		})),
	};
}

const LIST_LIMIT = 100;

async function list(routeCtx: { input?: unknown }, ctx: PluginContext) {
	const status = obj(routeCtx.input).status;
	if (status !== undefined && !isEnvelopeStatus(status)) return badRequest();
	const { items } = await stores(ctx).envelopes.query({
		...(status === undefined ? {} : { where: { status } }),
		orderBy: { createdAt: "desc" },
		limit: LIST_LIMIT,
	});
	return { ok: true, envelopes: items.map((i) => summary(i.id, i.data)) };
}

export const ENVELOPE_ROUTES: Record<string, RouteDef> = {
	"envelopes/create": { handler: create as Handler },
	"envelopes/send": { handler: send as Handler },
	"envelopes/get": { handler: get as Handler },
	"envelopes/list": { handler: list as Handler },
	"outbox/status": { handler: (async (_r, ctx) => ({ ok: true, ...(await outboxReport(ctx)) })) as Handler },
};

// --- public/envelopes/from-intent ---

export interface FromIntentDeps {
	/** Epoch milliseconds. */
	now?: () => number;
	random?: RandomBytes;
}

function allowlistOf(value: unknown): string[] | undefined {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;
}

function siteOrigin(ctx: PluginContext): string | undefined {
	try {
		return new URL(ctx.site.url).origin;
	} catch {
		return undefined;
	}
}

/**
 * Protocol §8.1. Bridge calls: settings + client (2), nonce (1), template (1), then the create-only
 * envelope write first (1), snapshot, signer and opening audit-event writes (3), plus the outbox
 * put for email delivery (1): 8 inline, 9 email. The existing-envelopes read happens only when the
 * create-only write loses: a replay is then 7 (inline reuse adds a token rotation), and a retry
 * after a declined, voided or expired envelope costs the read and a second create: 10 inline.
 */
export async function fromIntent(input: unknown, ctx: PluginContext, deps: FromIntentDeps = {}): Promise<unknown> {
	const nowMs = (deps.now ?? Date.now)();
	const now = new Date(nowMs).toISOString();
	const { envelopes, signers, snapshots, templates, clients, nonces } = stores(ctx);
	let settings: Record<string, unknown> = {};

	const getClient = async (cid: string): Promise<EsignClient | undefined> => {
		const [all, found] = await Promise.all([
			ctx.settings.list(),
			clients.query({ where: { clientId: cid }, limit: 1 }),
		]);
		settings = Object.fromEntries(all.map((s) => [s.key, s.value]));
		const key = masterKeyBytes(settings.integrationMasterKey);
		const client = found.items[0]?.data;
		if (!key || !client) return undefined;
		return {
			secret: await deriveClientSecret(key, cid),
			revoked: client.revokedAt !== undefined && client.revokedAt !== null,
			returnUrlAllowlist: allowlistOf(client.returnUrlAllowlist),
		};
	};

	const consumeNonce = async (cid: string, nonce: string, expiresAt: number): Promise<boolean> => {
		const id = `${cid}.${nonce}`;
		try {
			const doc = { nonce: id, cid, expiresAt: new Date(expiresAt * 1000).toISOString() };
			return (await nonces.compareAndSet(id, null, doc)).applied;
		} catch (error) {
			if (isUniqueViolation(error)) return false;
			throw error;
		}
	};

	const verified = await verifyIntentToken({
		token: obj(input).intent,
		now: nowMs,
		getClient,
		consumeNonce,
		siteOrigin: siteOrigin(ctx),
	});
	if (!verified.ok) return fail(verified.error);
	const intent = verified.value;

	const versionId = intent.tplVersion === undefined ? undefined : versionDocId(intent.tpl, intent.tplVersion);
	const docs = await templates.getMany(versionId === undefined ? [intent.tpl] : [intent.tpl, versionId]);
	const template = pickTemplateVersion(
		docs.get(intent.tpl),
		versionId === undefined ? undefined : docs.get(versionId),
		intent.tplVersion,
	);
	if (!template.ok) return fail("TEMPLATE_NOT_FOUND");

	const piiSalt = newPiiSalt(deps.random);
	const draft = draftFromIntent(intent, template.value, { now, piiSalt });
	if (!draft.ok) return badRequest(draft.error);
	const token = generateToken(deps.random);
	const tokenHash = await hashToken(token);
	const build = async (attempt: number) => {
		const id = await envelopeIdForRef(intent.cid, intent.ref, attempt);
		const sent = await sendEnvelope(id, draft.value, template.value, {
			now,
			tokenHash,
			expiryDays: expiryDays(settings.expiryDays),
		});
		return { id, sent };
	};

	// Optimistic first attempt: most intents are the first for their (cid, ref), so the create-only
	// write goes first and the existing-envelopes read only happens when it loses.
	let attempt = await build(1);
	if (!attempt.sent.ok) return Array.isArray(attempt.sent.error) ? badRequest(attempt.sent.error) : fail("INTERNAL");
	let created = await envelopes.compareAndSet(attempt.id, null, attempt.sent.value.envelope);
	if (!created.applied) {
		const previous = await envelopes.query({
			where: { clientId: intent.cid, externalRef: intent.ref },
			limit: LIST_LIMIT,
		});
		const current = existingForRef(previous.items);
		if (current) {
			// A draft here is an email intent whose finishing task may never have been scheduled.
			if (current.data.status === "draft") await scheduleIntentFinish(ctx.cron, current.id, nowMs);
			return reuse(signers, current.id, current.data, deps.random);
		}
		// Every earlier envelope for the pair was declined, voided or expired: start the next one.
		const next = Math.max(previous.items.length, 1) + 1;
		if (draft.value.delivery === "email") {
			// 8 calls so far and the hard limit is 10: store a draft and let a cron task finish it.
			const draftId = await envelopeIdForRef(intent.cid, intent.ref, next);
			if (!(await envelopes.compareAndSet(draftId, null, draft.value)).applied) {
				const winner = await envelopes.get(draftId);
				return winner ? reuse(signers, draftId, winner, deps.random) : fail("INTERNAL");
			}
			await scheduleIntentFinish(ctx.cron, draftId, nowMs);
			return response(draftId, draft.value, undefined);
		}
		attempt = await build(next);
		if (!attempt.sent.ok) return Array.isArray(attempt.sent.error) ? badRequest(attempt.sent.error) : fail("INTERNAL");
		created = await envelopes.compareAndSet(attempt.id, null, attempt.sent.value.envelope);
		if (!created.applied) {
			const winner = await envelopes.get(attempt.id);
			return winner ? reuse(signers, attempt.id, winner, deps.random) : fail("INTERNAL");
		}
	}
	const { id, sent } = attempt;
	if (!sent.ok) return fail("INTERNAL");
	// Chunk ids are hash-addressed, and only the winner of the create-only write gets here.
	await snapshots.putMany(sent.value.chunks);
	const stored = await insertSigner(signers, sent.value.signer, token, deps.random);
	if (sent.value.envelope.delivery === "email") {
		// The only place the token exists besides the hash: queued for the cron drain (1 call).
		await queueInvitation(ctx, {
			signerId: sent.value.signer.id,
			envelope: sent.value.envelope,
			token: stored,
			senderSetting: settings.senderName,
			now: nowMs,
		});
	}
	// This request won the create-only envelope write, so it alone opens the chain: one putMany.
	const opening = [createdAuditEvent(draft.value, "integration"), sentAuditEvent(sent.value.envelope, "integration")];
	await stores(ctx).audit_events.putMany(await initialAuditEvents(id, opening, piiSalt));
	return response(id, sent.value.envelope, stored);
}

function response(id: string, envelope: EnvelopeDoc, token: string | undefined) {
	return {
		ok: true,
		envelopeId: id,
		status: envelope.status,
		...(token !== undefined && envelope.delivery === "inline" ? { signingToken: token } : {}),
	};
}

/**
 * Idempotent return for an existing `(cid, ref)` envelope. Only the token hash is stored, so an
 * inline signer who has not signed yet gets a fresh token (the previous one stops working).
 */
async function reuse(signers: Collection<SignerDoc>, id: string, envelope: EnvelopeDoc, random?: RandomBytes) {
	const signerId = envelope.signerIds[0];
	const awaiting = envelope.status === "sent" || envelope.status === "in_progress";
	if (envelope.delivery !== "inline" || !awaiting || signerId === undefined) return response(id, envelope, undefined);
	const rotated = await withUniqueToken(generateToken(random), random, (tokenHash) =>
		signers.updateIf(signerId, { where: { status: "pending" }, set: { tokenHash } }),
	);
	return response(id, envelope, rotated.value.applied ? rotated.token : undefined);
}

export const fromIntentHandler: RouteHandler = (routeCtx, ctx) => fromIntent(routeCtx.input, ctx);
