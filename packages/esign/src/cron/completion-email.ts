/**
 * The completion email (ES-FR-10): a one-shot cron task `completion-email-<envelopeId>` that the
 * signed-PDF job schedules once it has recorded the PDF. It makes the short-lived download link
 * `/signed/<token>` link and queues the email in the outbox, which the recurring drain then sends.
 * Only a token's hash is stored, so the job mints a separate copy token (`copyTokenHash`, R36/T115)
 * and leaves the signing token alone, so the sign page's post-submit poll keeps working. The stable
 * page issues a fresh download link on each visit (T032). A separate task keeps the PDF job at 7 bridge calls; this one is envelope (1),
 * sender setting (1), queued row (1), copy-token write (1), outbox put (1): 5.
 */
import { generateToken } from "@semics-tech/shared";
import type { CronEvent, PluginContext } from "emdash/plugin";
import { queueCompletion, siteOrigin } from "../emails/outbox";
import { stores, withUniqueToken } from "../routes/envelopes";

export const COMPLETION_TASK_PREFIX = "completion-email-";
export const completionTaskName = (envelopeId: string) => `${COMPLETION_TASK_PREFIX}${envelopeId}`;

export interface CompletionCron {
	schedule(name: string, opts: { schedule: string; data?: Record<string, unknown> }): Promise<void>;
}

export function scheduleCompletionEmail(cron: CompletionCron | undefined, envelopeId: string, at: number) {
	return cron?.schedule(completionTaskName(envelopeId), {
		schedule: new Date(at).toISOString(),
		data: { envelopeId },
	});
}

/** Queues the email for a completed envelope whose PDF is stored. Returns whether it queued. */
export async function queueCompletionEmail(ctx: PluginContext, envelopeId: string, now: number): Promise<boolean> {
	const [envelope, sender, queued] = await Promise.all([
		stores(ctx).envelopes.get(envelopeId),
		ctx.settings.get("senderName"),
		stores(ctx).outbox.get(`complete-${envelopeId}`),
	]);
	if (!envelope || envelope.status !== "completed" || !envelope.pdfSha256) return false;
	// A repeated run must not rotate the token again: the mail already queued carries the live one.
	if (queued) return false;
	const signerId = envelope.signerIds[0];
	if (signerId === undefined) return false;
	// No site URL: no email with a relative link (T117); the token is not rotated for nothing.
	if (!siteOrigin(ctx)) return false;
	// The signing token is left alone (the sign page's poll still holds it): the copy token is its own credential.
	const rotated = await withUniqueToken(generateToken(), undefined, (copyTokenHash) =>
		stores(ctx).signers.updateIf(signerId, { where: { status: "signed" }, set: { copyTokenHash } }),
	);
	if (!rotated.value.applied) return false;
	await queueCompletion(ctx, { envelopeId, envelope, token: rotated.token, senderSetting: sender, now });
	return true;
}

/** The `cron` hook's share for this job; true when `event` was one of ours. */
export async function runCompletionEmailJob(event: CronEvent, ctx: PluginContext): Promise<boolean> {
	if (!event.name.startsWith(COMPLETION_TASK_PREFIX)) return false;
	const envelopeId = event.data?.envelopeId;
	if (typeof envelopeId === "string" && envelopeId.length > 0) await queueCompletionEmail(ctx, envelopeId, Date.now());
	return true;
}
