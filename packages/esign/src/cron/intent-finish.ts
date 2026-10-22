/**
 * Finishing an email-delivery intent (T113): a one-shot cron task `intent-finish-<envelopeId>`.
 *
 * A retry after a declined, voided or expired envelope for the same `(cid, ref)` has already spent
 * 8 bridge calls in `public/envelopes/from-intent` by the time the next envelope's create-only write
 * is done, so that route stores the envelope as a `draft` and schedules this task instead of also
 * writing the snapshot, signer, invitation and opening audit events (it would pass the hard limit
 * of 10). The envelope is not `sent` until this task has written all of that, and the guarded
 * `draft → sent` update is the last write.
 *
 * Bridge calls: envelope (1), template and settings (2), snapshot chunks (1), signer (1), outbox
 * put (1), opening audit events (1), guarded update (1) = 8. A re-run finds a non-draft envelope
 * after the first read and stops. A run that died part way re-runs the whole sequence: every write
 * before the guarded update is a deterministic-id put, so it overwrites itself.
 *
 * The signing token is deterministic per envelope (T117): `HMAC-SHA256(integrationMasterKey,
 * "esign-invite/1." + envelopeId)`, base64url. Two runs that overlap (both read the draft before either
 * finished) therefore write the same signer `tokenHash` and the same invitation, in any interleaving;
 * with a random token per run the signer could keep one run's hash and the queued mail the other's (a
 * dead link). The master key is already read and is a secret (encrypted at rest), so the token cannot be
 * derived from what storage holds; only an email-delivery intent's first token is made this way, and a
 * resend or the completion email still use random tokens.
 */
import { encodeBase64Url, hashToken, hmacSha256Key, toIso } from "@semics-tech/shared";
import type { CronEvent, PluginContext } from "emdash/plugin";
import { initialAuditEvents } from "../domain/audit";
import { createdAuditEvent, pickTemplateVersion, sendEnvelope, sentAuditEvent } from "../domain/envelopes";
import { masterKeyBytes } from "../domain/master-key";
import { transitionEnvelope } from "../domain/state";
import { versionDocId } from "../domain/templates";
import { queueInvitation } from "../emails/outbox";
import { expiryDays, insertSigner, stores } from "../routes/envelopes";

export const INTENT_FINISH_PREFIX = "intent-finish-";
export const intentFinishTaskName = (envelopeId: string) => `${INTENT_FINISH_PREFIX}${envelopeId}`;

export interface IntentFinishCron {
	schedule(name: string, opts: { schedule: string; data?: Record<string, unknown> }): Promise<void>;
}

/** Schedules (or re-arms) the task for `envelopeId` at `at` (one bridge call). */
export function scheduleIntentFinish(cron: IntentFinishCron | undefined, envelopeId: string, at: number) {
	return cron?.schedule(intentFinishTaskName(envelopeId), {
		schedule: toIso(at),
		data: { envelopeId },
	});
}

export type IntentFinishResult = "sent" | "skipped";

/** The invitation token for `envelopeId`, the same in every run (see above). */
export async function intentInviteToken(masterKey: Uint8Array, envelopeId: string): Promise<string> {
	const key = await hmacSha256Key(masterKey);
	const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`esign-invite/1.${envelopeId}`));
	return encodeBase64Url(new Uint8Array(mac));
}

export async function finishIntent(ctx: PluginContext, envelopeId: string, now: number): Promise<IntentFinishResult> {
	const { envelopes, templates, snapshots, signers, audit_events } = stores(ctx);
	const envelope = await envelopes.get(envelopeId);
	if (!envelope || envelope.status !== "draft" || envelope.delivery !== "email" || !envelope.clientId) return "skipped";
	const versionId = versionDocId(envelope.templateId, envelope.templateVersion);
	const [docs, all] = await Promise.all([templates.getMany([envelope.templateId, versionId]), ctx.settings.list()]);
	const settings = Object.fromEntries(all.map((s) => [s.key, s.value]));
	const template = pickTemplateVersion(docs.get(envelope.templateId), docs.get(versionId), envelope.templateVersion);
	if (!template.ok) return "skipped";
	// The client's key was there when the intent was verified; without it now, the draft waits.
	const masterKey = masterKeyBytes(settings.integrationMasterKey);
	if (!masterKey) return "skipped";
	const token = await intentInviteToken(masterKey, envelopeId);
	const sent = await sendEnvelope(envelopeId, envelope, template.value, {
		now: toIso(now),
		tokenHash: await hashToken(token),
		expiryDays: expiryDays(settings.expiryDays),
	});
	if (!sent.ok) return "skipped";
	await snapshots.putMany(sent.value.chunks);
	const stored = await insertSigner(signers, sent.value.signer, token);
	await queueInvitation(ctx, {
		signerId: sent.value.signer.id,
		envelope: sent.value.envelope,
		token: stored,
		senderSetting: settings.senderName,
		now,
	});
	const opening = [createdAuditEvent(envelope, "integration"), sentAuditEvent(sent.value.envelope, "integration")];
	await audit_events.putMany(await initialAuditEvents(envelopeId, opening, envelope.piiSalt));
	const moved = await transitionEnvelope(envelopes, envelopeId, "draft", "sent", sent.value.envelope);
	return moved.ok ? "sent" : "skipped";
}

/** The `cron` hook's share for this task; true when `event` was one of ours. */
export async function runIntentFinishJob(event: CronEvent, ctx: PluginContext): Promise<boolean> {
	if (!event.name.startsWith(INTENT_FINISH_PREFIX)) return false;
	const envelopeId = event.data?.envelopeId;
	if (typeof envelopeId === "string" && envelopeId.length > 0) await finishIntent(ctx, envelopeId, Date.now());
	return true;
}
