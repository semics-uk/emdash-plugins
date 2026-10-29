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
	generateToken,
	hashToken,
	type IntentPayload,
	type RandomBytes,
	toIso,
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
import { transitionEnvelope } from "../domain/state";
import { availableToIntegrations, versionDocId } from "../domain/templates";
import { queueInvitation } from "../emails/outbox";
import {
	appendAudit,
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
import { integrationClients } from "./integration";

export interface FromIntentDeps {
	/** Epoch milliseconds. */
	now?: () => number;
	random?: RandomBytes;
}

/** Envelopes read for one `(cid, ref)`: each retry after a terminal envelope adds one. */
const REF_LIMIT = 100;

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
	const now = toIso(nowMs);
	const { envelopes, signers, snapshots, templates, nonces } = stores(ctx);
	const clients = integrationClients(ctx);

	const consumeNonce = async (cid: string, nonce: string, expiresAt: number): Promise<boolean> => {
		const id = `${cid}.${nonce}`;
		try {
			const doc = { nonce: id, cid, expiresAt: toIso(expiresAt * 1000) };
			return (await nonces.compareAndSet(id, null, doc)).applied;
		} catch (error) {
			if (isUniqueViolation(error)) return false;
			throw error;
		}
	};

	const verified = await verifyIntentToken({
		token: obj(input).intent,
		now: nowMs,
		getClient: clients.getClient,
		consumeNonce,
		siteOrigin: siteOrigin(ctx),
	});
	if (!verified.ok) return fail(verified.error);
	const intent = verified.value;
	const settings = clients.settings();
	if (intent.replace === true) return replaceOpen(ctx, intent, now);

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
	const asked = { delivery: draft.value.delivery, signer: draft.value.signer };
	// T133 (R95): an email intent with `resend: true` queues the open envelope's invitation again.
	const resend =
		intent.resend === true
			? (signerId: string, envelope: EnvelopeDoc, token: string) =>
					queueInvitation(ctx, { signerId, envelope, token, senderSetting: settings.senderName, now: nowMs })
			: undefined;
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
			return reuse(signers, current.id, current.data, asked, deps.random, resend);
		}
		// Every earlier envelope for the pair was declined, voided or expired: start the next one.
		const next = Math.max(previous.items.length, 1) + 1;
		if (draft.value.delivery === "email") {
			// 8 calls so far and the hard limit is 10: store a draft and let a cron task finish it.
			const draftId = await envelopeIdForRef(intent.cid, intent.ref, next);
			if (!(await envelopes.compareAndSet(draftId, null, draft.value)).applied) {
				const winner = await envelopes.get(draftId);
				return winner ? reuse(signers, draftId, winner, asked, deps.random) : fail("INTERNAL");
			}
			await scheduleIntentFinish(ctx.cron, draftId, nowMs);
			return response(draftId, draft.value, undefined);
		}
		attempt = await build(next);
		if (!attempt.sent.ok) return Array.isArray(attempt.sent.error) ? badRequest(attempt.sent.error) : fail("INTERNAL");
		created = await envelopes.compareAndSet(attempt.id, null, attempt.sent.value.envelope);
		if (!created.applied) {
			const winner = await envelopes.get(attempt.id);
			return winner ? reuse(signers, attempt.id, winner, asked, deps.random) : fail("INTERNAL");
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

function response(
	id: string,
	envelope: EnvelopeDoc,
	token: string | undefined,
	inline = envelope.delivery === "inline",
) {
	return {
		ok: true,
		envelopeId: id,
		status: envelope.status,
		...(token !== undefined && inline ? { signingToken: token } : {}),
	};
}

/** The person an intent names, in the form envelopes store it (`draftFromIntent`). */
type IntentSigner = EnvelopeDoc["signer"];

/** True when `envelope` waits for exactly the signer the intent names, in the same capacity. */
function awaitsSigner(envelope: EnvelopeDoc, signer: IntentSigner): boolean {
	const stored = envelope.signer;
	return (
		stored.email === signer.email &&
		stored.as === signer.as &&
		(stored.participant?.name ?? null) === (signer.participant?.name ?? null)
	);
}

/**
 * Idempotent return for an existing `(cid, ref)` envelope. A signing token goes only to an inline
 * intent while the envelope awaits the signer that intent names (§8.1, T067): same email and
 * capacity (and, for a guardian, the same participant). That covers the buyer's retry and Events'
 * door-signing link for an attendee whose emailed envelope is still open. Only the hash is stored, so
 * the token is rotated and the previous one (for an email envelope, the emailed link) stops working.
 * An intent naming anyone else gets the envelope's id and status but no token, so it can never take
 * over another person's session.
 */
async function reuse(
	signers: Collection<SignerDoc>,
	id: string,
	envelope: EnvelopeDoc,
	intent: { delivery: string; signer: IntentSigner },
	random?: RandomBytes,
	resend?: (signerId: string, envelope: EnvelopeDoc, token: string) => Promise<string | null>,
) {
	const signerId = envelope.signerIds[0];
	const awaiting = envelope.status === "sent" || envelope.status === "in_progress";
	const ours = awaiting && awaitsSigner(envelope, intent.signer);
	const handOver = intent.delivery === "inline" && ours;
	// Resend (T133, R95): the same person's email intent for an emailed envelope, its link rotated.
	const again = resend !== undefined && intent.delivery === "email" && envelope.delivery === "email" && ours;
	if ((!handOver && !again) || signerId === undefined) return response(id, envelope, undefined);
	const rotated = await withUniqueToken(generateToken(random), random, (tokenHash) =>
		signers.updateIf(signerId, { where: { status: "pending" }, set: { tokenHash } }),
	);
	if (!rotated.value.applied) return response(id, envelope, undefined);
	if (handOver || !resend) return response(id, envelope, rotated.token, true);
	// Without a site URL nothing is queued (null): the answer then says nothing was resent.
	const queued = await resend(signerId, envelope, rotated.token);
	return { ...response(id, envelope, undefined), ...(queued ? { resent: true } : {}) };
}

/**
 * `replace: true` (T133, R95): the buyer corrected a seat's attendee, so the envelope still open for
 * `(cid, ref)` is voided (status machine, `envelope.voided` by the integration) unless it names
 * exactly this signer, name included (the document names them). It never creates an envelope: the
 * issuer's next, ordinary intent starts the seat's next one, like any retry after a voided envelope.
 * A completed envelope is never touched, and no signing token is ever handed out. 7 bridge calls:
 * settings + client, nonce, the pair's envelopes, the transition and the audit append (2).
 */
async function replaceOpen(ctx: PluginContext, intent: IntentPayload, now: string) {
	const { envelopes } = stores(ctx);
	const previous = await envelopes.query({
		where: { clientId: intent.cid, externalRef: intent.ref },
		limit: REF_LIMIT,
	});
	const current = existingForRef(previous.items);
	if (!current) return { ok: true, status: "none" };
	const stored = current.data.signer;
	const same =
		stored.name === intent.signer.name.trim() &&
		stored.email === intent.signer.email.trim().toLowerCase() &&
		stored.as === (intent.as ?? "self") &&
		(stored.participant?.name ?? null) === (intent.participant?.name.trim() ?? null);
	if (same || current.data.status === "completed") return response(current.id, current.data, undefined);
	const moved = await transitionEnvelope(envelopes, current.id, current.data.status, "voided", {
		closedAt: now,
		updatedAt: now,
	});
	if (!moved.ok) return fail("ENVELOPE_CLOSED");
	await appendAudit(ctx, current.id, moved.value, { type: "envelope.voided", at: now, actor: "integration" });
	return response(current.id, moved.value, undefined);
}

export const fromIntentHandler: RouteHandler = (routeCtx, ctx) => fromIntent(routeCtx.input, ctx);
