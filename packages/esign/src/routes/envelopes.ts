/**
 * Envelope routes (ES-FR-02, ES-FR-03): thin adapters over `domain/envelopes` and `domain/state`.
 *
 * Private (admin): `envelopes/create` (draft), `envelopes/send` (freeze + signer), `envelopes/get`,
 * `envelopes/list`, `envelopes/resend`, `envelopes/void`. The public `envelopes/from-intent` lives
 * in `./from-intent.ts` and shares the helpers exported here.
 *
 * Every status change goes through `transitionEnvelope` (or, for an envelope created already sent,
 * through `sendEnvelope`'s `draft → sent` check), so the table in `domain/state.ts` is the one
 * source of truth for routes and cron jobs. Each handler stays at ≤ 8 bridge calls (R22), except
 * `send` at 9 (it queues the invitation). Create and send write the envelope's opening
 * `audit_events` (domain/audit.ts).
 */
import {
	generateToken,
	hashToken,
	type OutboxRecord,
	type RandomBytes,
	toIso,
	toRouteError,
} from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import {
	type AuditEventDoc,
	type AuditInput,
	appendAuditEvent,
	auditEventId,
	extendAuditChain,
	initialAuditEvents,
	newPiiSalt,
	writeAuditEvents,
} from "../domain/audit";
import {
	buildDraft,
	createdAuditEvent,
	type EnvelopeDoc,
	joinSnapshot,
	parseDraftInput,
	pickTemplateVersion,
	type SignerDoc,
	type SnapshotChunkDoc,
	sendEnvelope,
	sentAuditEvent,
} from "../domain/envelopes";
import type { ArtifactChunkDoc } from "../domain/pdf";
import { canTransition, isEnvelopeStatus, transitionEnvelope } from "../domain/state";
import { type TemplateDoc, versionDocId } from "../domain/templates";
import { outboxReport, queueInvitation, SITE_URL_WARNING, siteOrigin } from "../emails/outbox";
import { downloadLink } from "./download";

type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
/** What the handlers read of the route context: the input and, on a private route, the acting user (T117). */
export interface EnvelopeRouteCtx {
	input?: unknown;
	user?: { id?: unknown } | null;
}
type Handler = (routeCtx: EnvelopeRouteCtx, ctx: PluginContext) => Promise<unknown>;

/** The acting admin's user id for the audit chain (T117): the host-authenticated `routeCtx.user`, never the email. */
const userIdOf = (routeCtx: EnvelopeRouteCtx): string | undefined =>
	typeof routeCtx.user?.id === "string" && routeCtx.user.id.length > 0 ? routeCtx.user.id : undefined;

// --- storage access (the slice of StorageCollection each handler uses) ---

export interface Collection<T> {
	get(id: string): Promise<T | null>;
	getMany(ids: string[]): Promise<Map<string, T>>;
	put(id: string, data: T): Promise<void>;
	putMany(items: Array<{ id: string; data: T }>): Promise<void>;
	deleteMany(ids: string[]): Promise<number>;
	compareAndSet(id: string, expectedRevision: string | null, data: T): Promise<{ applied: boolean }>;
	updateIf(
		id: string,
		args: { where: Record<string, unknown>; set?: Partial<T> },
	): Promise<{ applied: true; data: T } | { applied: false }>;
	query(o: {
		where?: Record<string, unknown>;
		orderBy?: Record<string, "asc" | "desc">;
		limit?: number;
		cursor?: string;
	}): Promise<{ items: Array<{ id: string; data: T }>; hasMore?: boolean; cursor?: string }>;
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
	outbox: Collection<OutboxRecord>;
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
export async function withUniqueToken<T>(
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
export async function appendAudit(ctx: PluginContext, id: string, envelope: EnvelopeDoc, input: AuditInput) {
	const appended = await appendAuditEvent(stores(ctx).audit_events, id, input, { salt: envelope.piiSalt });
	if (!appended.ok) throw new Error("audit chain contention");
}

// --- private routes ---

async function create(routeCtx: EnvelopeRouteCtx, ctx: PluginContext) {
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
	const draft = buildDraft(fields.value, template.value, { now: toIso(), piiSalt });
	if (!draft.ok) return badRequest(draft.error);
	const id = crypto.randomUUID();
	await envelopes.put(id, draft.value);
	// A fresh UUID: nobody else can be writing this chain yet.
	await audit_events.putMany(
		await initialAuditEvents(id, [createdAuditEvent(draft.value, "admin", userIdOf(routeCtx))], piiSalt),
	);
	return { ok: true, envelope: view(id, draft.value) };
}

async function send(routeCtx: EnvelopeRouteCtx, ctx: PluginContext) {
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
		now: toIso(),
		tokenHash: await hashToken(token),
		expiryDays: expiryDays(settings.expiryDays),
	});
	if (!sent.ok) return Array.isArray(sent.error) ? badRequest(sent.error) : fail("ENVELOPE_CLOSED");
	await snapshots.putMany(sent.value.chunks);
	const moved = await transitionEnvelope(envelopes, id, "draft", "sent", sent.value.envelope);
	if (!moved.ok) return fail("ENVELOPE_CLOSED");
	// The token goes out in the invitation email (T027); it is never returned.
	const stored = await insertSigner(signers, sent.value.signer, token);
	const queued = await queueInvitation(ctx, {
		signerId: sent.value.signer.id,
		envelope: moved.value,
		token: stored,
		senderSetting: settings.senderName,
		now: Date.now(),
	});
	// Only the winner of the guarded draft → sent update gets here, so at most one `sent` event.
	await appendAudit(ctx, id, moved.value, sentAuditEvent(moved.value, "admin", userIdOf(routeCtx)));
	// No site URL: no invitation with a relative link was queued (T117); the admin says so.
	return { ok: true, envelope: view(id, moved.value), ...(queued ? {} : { invitation: "SITE_URL_MISSING" }) };
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

/**
 * Admin "resend invitation" (T027 follow-up). A `sent` envelope whose invitation is not in the
 * outbox (queueing threw after the signer was stored) or whose row gave up (`failed`) gets a fresh
 * signing token (only the hash is stored, so the old mail cannot be resent) and a new queued
 * invitation under the same deterministic outbox id. If the failed `send` also never wrote its
 * `envelope.sent` audit event, it is written now at its own place, right after `envelope.created`,
 * with a create-only write: if anything else already took that place (a view, a decline or a void
 * that raced this resend), the envelope has moved on and no `envelope.sent` is added after it (T117).
 * Without a site URL nothing is changed (no relative link is ever queued). At most 7 bridge calls.
 */
async function resend(routeCtx: EnvelopeRouteCtx, ctx: PluginContext) {
	const id = idOf(routeCtx.input);
	if (!id) return badRequest();
	const { envelopes, signers, outbox, audit_events } = stores(ctx);
	const envelope = await envelopes.get(id);
	if (!envelope) return fail("ENVELOPE_NOT_FOUND");
	const signerId = envelope.signerIds[0];
	if (envelope.status !== "sent" || signerId === undefined) return fail("ENVELOPE_CLOSED");
	if (!siteOrigin(ctx)) return { ok: false, error: { code: "SITE_URL_MISSING", message: SITE_URL_WARNING } };
	const createdId = auditEventId(id, 0);
	const sentId = auditEventId(id, 1);
	const [senderName, queued, opening] = await Promise.all([
		ctx.settings.get<string>("senderName"),
		outbox.get(`invite-${signerId}`),
		audit_events.getMany([createdId, sentId]),
	]);
	if (queued && queued.status !== "failed") {
		return { ok: false, error: { code: "INVITATION_QUEUED", message: "The invitation is already queued or sent." } };
	}
	const token = generateToken();
	const rotated = await withUniqueToken(token, undefined, (tokenHash) =>
		signers.updateIf(signerId, { where: { status: "pending" }, set: { tokenHash } }),
	);
	if (!rotated.value.applied) return fail("ENVELOPE_CLOSED");
	await queueInvitation(ctx, {
		signerId,
		envelope,
		token: rotated.token,
		senderSetting: senderName,
		now: Date.now(),
	});
	let repaired = false;
	if (!opening.has(sentId)) {
		// The position after `envelope.created` (the genesis when even that is missing), create-only.
		const repair = await extendAuditChain(
			id,
			opening.get(createdId) ?? null,
			[sentAuditEvent(envelope, "admin", userIdOf(routeCtx))],
			envelope.piiSalt,
		);
		repaired = await writeAuditEvents(audit_events, repair);
	}
	const { name, email, status } = rotated.value.data;
	return {
		ok: true,
		envelope: view(id, envelope),
		signers: [{ id: signerId, order: rotated.value.data.order, name, email, status }],
		repaired,
	};
}

/** Admin void: any non-terminal envelope, through the status machine, with its audit event (4 calls). */
async function voidEnvelope(routeCtx: EnvelopeRouteCtx, ctx: PluginContext) {
	const id = idOf(routeCtx.input);
	if (!id) return badRequest();
	const envelope = await stores(ctx).envelopes.get(id);
	if (!envelope) return fail("ENVELOPE_NOT_FOUND");
	const at = toIso();
	const moved = await transitionEnvelope(stores(ctx).envelopes, id, envelope.status, "voided", {
		closedAt: at,
		updatedAt: at,
	});
	if (!moved.ok) return fail("ENVELOPE_CLOSED");
	await appendAudit(ctx, id, moved.value, {
		type: "envelope.voided",
		at,
		actor: "admin",
		...(userIdOf(routeCtx) ? { data: { userId: userIdOf(routeCtx) as string } } : {}),
	});
	return { ok: true, envelope: view(id, moved.value) };
}

const LIST_LIMIT = 100;

/** Newest first, 100 a page; `cursor` (from the previous page) continues the same filter (T034). */
async function list(routeCtx: { input?: unknown }, ctx: PluginContext) {
	const { status, cursor } = obj(routeCtx.input);
	if (status !== undefined && !isEnvelopeStatus(status)) return badRequest();
	if (cursor !== undefined && !(typeof cursor === "string" && cursor.length > 0 && cursor.length <= 500)) {
		return badRequest();
	}
	const page = await stores(ctx).envelopes.query({
		...(status === undefined ? {} : { where: { status } }),
		orderBy: { createdAt: "desc" },
		limit: LIST_LIMIT,
		...(cursor === undefined ? {} : { cursor }),
	});
	return {
		ok: true,
		envelopes: page.items.map((i) => summary(i.id, i.data)),
		...(page.hasMore && page.cursor ? { nextCursor: page.cursor } : {}),
	};
}

export const ENVELOPE_ROUTES: Record<string, RouteDef> = {
	"envelopes/create": { handler: create as Handler },
	"envelopes/send": { handler: send as Handler },
	"envelopes/get": { handler: get as Handler },
	"envelopes/list": { handler: list as Handler },
	"envelopes/resend": { handler: resend as Handler },
	"envelopes/void": { handler: voidEnvelope as Handler },
	"outbox/status": { handler: (async (_r, ctx) => ({ ok: true, ...(await outboxReport(ctx)) })) as Handler },
};
