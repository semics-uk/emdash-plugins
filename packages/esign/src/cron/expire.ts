/**
 * Expiry (T092, ES-FR-17, R45). Free gives every unsigned envelope an end: the hourly `expire` task
 * closes `sent` and `in_progress` envelopes whose `expiresAt` (set at send from `expiryDays`) has
 * passed, so retention can purge them. The status change goes through the status machine (a signer
 * who completes first wins: the guarded update then does nothing) and writes `envelope.expired`.
 * A tick is one query plus 3 calls per envelope (guarded update, audit head, audit write), at most
 * `EXPIRE_BATCH` of them, then the one-shot `expire-more` when more are due: 8 calls. Automatic
 * reminders (the `reminderCadenceDays` setting) are Pro.
 */
import { toIso } from "@semics-tech/shared";
import type { CronEvent, PluginContext } from "emdash/plugin";
import { transitionEnvelope } from "../domain/state";
import { appendAudit, stores } from "../routes/envelopes";

export const EXPIRE_TASK = "expire";
export const EXPIRE_MORE_TASK = "expire-more";
export const EXPIRE_SCHEDULE = "17 * * * *";
export const EXPIRE_BATCH = 2;

export async function runExpireJob(event: CronEvent, ctx: PluginContext): Promise<boolean> {
	if (event.name !== EXPIRE_TASK && event.name !== EXPIRE_MORE_TASK) return false;
	const { envelopes } = stores(ctx);
	const at = toIso();
	const due = await envelopes.query({
		where: { status: { in: ["sent", "in_progress"] }, expiresAt: { lt: at } },
		orderBy: { expiresAt: "asc" },
		limit: EXPIRE_BATCH,
	});
	for (const { id, data } of due.items) {
		const moved = await transitionEnvelope(envelopes, id, data.status, "expired", { closedAt: at, updatedAt: at });
		if (moved.ok) await appendAudit(ctx, id, moved.value, { type: "envelope.expired", at, actor: "system" });
	}
	if (due.hasMore) await ctx.cron?.schedule(EXPIRE_MORE_TASK, { schedule: toIso(Date.now() + 60_000) });
	return true;
}
