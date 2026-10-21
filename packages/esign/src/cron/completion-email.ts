/**
 * The completion email (ES-FR-10): a one-shot cron task `completion-email-<envelopeId>` that the
 * signed-PDF job schedules once it has recorded the PDF. It makes the short-lived download link
 * (`downloadLink`, T025) and queues the email in the outbox, which the recurring drain then sends.
 * A separate task keeps the PDF job at 7 bridge calls; this one is envelope (1), sender setting
 * (1), link key (1, or 3 the first time it is created), outbox put (1): at most 6.
 */
import type { CronEvent, PluginContext } from "emdash/plugin";
import { queueCompletion } from "../emails/outbox";
import { downloadLink } from "../routes/download";
import { stores } from "../routes/envelopes";

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
	const [envelope, sender] = await Promise.all([stores(ctx).envelopes.get(envelopeId), ctx.settings.get("senderName")]);
	if (!envelope || envelope.status !== "completed" || !envelope.pdfSha256) return false;
	const link = await downloadLink(ctx, envelopeId, now);
	await queueCompletion(ctx, { envelopeId, envelope, downloadUrl: link.url, senderSetting: sender, now });
	return true;
}

/** The `cron` hook's share for this job; true when `event` was one of ours. */
export async function runCompletionEmailJob(event: CronEvent, ctx: PluginContext): Promise<boolean> {
	if (!event.name.startsWith(COMPLETION_TASK_PREFIX)) return false;
	const envelopeId = event.data?.envelopeId;
	if (typeof envelopeId === "string" && envelopeId.length > 0) await queueCompletionEmail(ctx, envelopeId, Date.now());
	return true;
}
