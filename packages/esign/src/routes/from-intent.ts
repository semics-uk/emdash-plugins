/**
 * `public/envelopes/from-intent` (ES-FR-13, SX-NFR-02, SX-NFR-03; protocol §8.1, T022/T113/T061).
 *
 * Verifies an `esign-intent/1` token with the shared verifier (§6.2 check order: size, structure,
 * payload, client, signature, schema, time, return URL, then the single-use nonce), checks that the
 * template exists, is active and is flagged "available to integrations" (else `TEMPLATE_NOT_FOUND`,
 * after the nonce is spent, so the client mints a new intent), then creates and sends the envelope,
 * or returns the envelope already created for the intent's `(cid, ref)`.
 *
 * Client secrets are derived from the master key (S8), never stored. A consumed nonce is the
 * create-only document `nonces/<cid>.<nonce>` with ISO `expiresAt` = `exp` + 60 s; the hourly
 * `nonce-sweep` (cron/nonce-sweep.ts) deletes it after that.
 */
import {
	deriveClientSecret,
	type EsignClient,
	generateToken,
	hashToken,
	type RandomBytes,
	verifyIntentToken,
} from "@semics-tech/shared";
import type { PluginContext, RouteHandler } from "emdash/plugin";
import { scheduleIntentFinish } from "../cron/intent-finish";
import { initialAuditEvents, newPiiSalt } from "../domain/audit";
import {
	createdAuditEvent,
	draftFromIntent,
	type EnvelopeDoc,
	envelopeIdForRef,
	existingForRef,
	pickTemplateVersion,
	type SignerDoc,
	sendEnvelope,
	sentAuditEvent,
} from "../domain/envelopes";
import { masterKeyBytes } from "../domain/master-key";
import { availableToIntegrations, versionDocId } from "../domain/templates";
import { queueInvitation } from "../emails/outbox";
import {
	badRequest,
	type Collection,
	expiryDays,
	fail,
	insertSigner,
	isUniqueViolation,
	obj,
	stores,
	withUniqueToken,
} from "./envelopes";

export interface FromIntentDeps {
	/** Epoch milliseconds. */
	now?: () => number;
	random?: RandomBytes;
}

/** Envelopes read for one `(cid, ref)`: each retry after a terminal envelope adds one. */
const REF_LIMIT = 100;

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
 * Bridge calls: settings + client (2), nonce (1), template (1), then the create-only envelope write
 * first (1), snapshot, signer and opening audit-event writes (3), plus the outbox put for email
 * delivery (1): 8 inline, 9 email. The existing-envelopes read happens only when the create-only
 * write loses: a replay is then 7 (inline reuse adds a token rotation), and a retry after a
 * declined, voided or expired envelope costs the read and a second create: 10 inline.
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
	const head = docs.get(intent.tpl);
	// A template the admin has not made available to integrations looks missing (§8.1).
	if (!availableToIntegrations(head)) return fail("TEMPLATE_NOT_FOUND");
	const template = pickTemplateVersion(
		head,
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
			limit: REF_LIMIT,
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
