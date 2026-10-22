/**
 * E-sign's side of the shared email outbox (T015, ES-FR-10).
 *
 * Mail is queued with one `outbox.put` and sent by the recurring `outbox-drain` cron task
 * (`drainOutbox`: 1 query + up to 6 sends + 1 `putMany` = 8 calls; an empty tick is 1). Delivery is
 * at-least-once: a crash between `email.send` and the `putMany` sends that message again.
 *
 * The invitation holds the signing token in clear text until it is sent (the drain then scrubs the row, R32): only the token's hash is
 * stored anywhere else (T022), so the token has to travel in the queued message. The token is the
 * credential for one signer, valid until the envelope expires or is signed.
 */
import {
	type DrainResult,
	drainOutbox,
	enqueueEmail,
	type OutboxRecord,
	type OutboxStatus,
	type OutboxStatusReport,
	type OutboxStorage,
	outboxStatus,
} from "@semics-tech/shared";
import type { CronEvent, PluginContext } from "emdash/plugin";
import type { EnvelopeDoc } from "../domain/envelopes";
import { type CompletionInput, completionEmail, invitationEmail } from "./templates";

export const OUTBOX_TASK = "outbox-drain";
/** Every minute; a tick with nothing due costs one storage call. */
export const OUTBOX_SCHEDULE = "* * * * *";

interface OutboxCollection {
	put(id: string, data: OutboxRecord): Promise<void>;
	putMany(items: Array<{ id: string; data: OutboxRecord }>): Promise<void>;
	query(o: {
		where?: Record<string, unknown>;
		orderBy?: Record<string, "asc" | "desc">;
		limit?: number;
	}): Promise<{ items: Array<{ id: string; data: OutboxRecord }> }>;
}

/** Adapts `ctx.storage.outbox` to the narrow shape the shared outbox wants. */
export function outboxStorage(ctx: PluginContext): OutboxStorage {
	const collection = (ctx.storage as unknown as { outbox: OutboxCollection }).outbox;
	return {
		put: (id, data) => collection.put(id, data),
		putMany: (items) => collection.putMany([...items]),
		query: ({ status, nextAttemptAtLte, limit }: { status: OutboxStatus; nextAttemptAtLte?: number; limit: number }) =>
			collection.query({
				where: { status, ...(nextAttemptAtLte === undefined ? {} : { nextAttemptAt: { lte: nextAttemptAtLte } }) },
				orderBy: { nextAttemptAt: "asc" },
				limit,
			}),
	};
}

export function siteOrigin(ctx: PluginContext): string {
	try {
		return new URL(ctx.site.url).origin;
	} catch {
		return "";
	}
}

/** `senderName` setting, else the site's name. */
export const senderOf = (ctx: PluginContext, setting: unknown): string =>
	typeof setting === "string" && setting.trim() !== "" ? setting.trim() : ctx.site.name;

/** Queues the signing invitation: one storage call. Deterministic id, so a retry overwrites. */
export function queueInvitation(
	ctx: PluginContext,
	args: { signerId: string; envelope: EnvelopeDoc; token: string; senderSetting: unknown; now: number },
): Promise<string> {
	const { signerId, envelope, token, now } = args;
	const message = invitationEmail({
		to: envelope.signer.email,
		signerName: envelope.signer.name,
		title: envelope.title,
		sender: senderOf(ctx, args.senderSetting),
		link: `${siteOrigin(ctx)}/sign/${token}`,
		expiresAt: envelope.expiresAt,
	});
	return enqueueEmail(outboxStorage(ctx), message, now, () => `invite-${signerId}`);
}

/**
 * Queues the "signed" email: one storage call. It links the stable signed-copy page `/signed/<token>`
 * (the signer's fresh token, ES-US-6), never the 15-minute download link. Like the invitation, the
 * queued row holds the token in clear until the drain sends it and scrubs the row.
 */
export function queueCompletion(
	ctx: PluginContext,
	args: { envelopeId: string; envelope: EnvelopeDoc; token: string; senderSetting: unknown; now: number },
): Promise<string> {
	const input: CompletionInput = {
		to: args.envelope.signer.email,
		signerName: args.envelope.signer.name,
		title: args.envelope.title,
		sender: senderOf(ctx, args.senderSetting),
		link: `${siteOrigin(ctx)}/signed/${args.token}`,
	};
	return enqueueEmail(outboxStorage(ctx), completionEmail(input), args.now, () => `complete-${args.envelopeId}`);
}

/** The `cron` hook's share for the recurring drain; true when `event` was ours. */
export async function runOutboxJob(event: CronEvent, ctx: PluginContext, now = Date.now()): Promise<boolean> {
	if (event.name !== OUTBOX_TASK) return false;
	const result: DrainResult = await drainOutbox({ storage: outboxStorage(ctx), email: ctx.email, now });
	if (result.gaveUp > 0) ctx.log.error("emails given up after repeated failures", { count: result.gaveUp });
	return true;
}

/** `plugin:activate`: (re)schedule the recurring drain. */
export async function scheduleOutbox(ctx: PluginContext): Promise<void> {
	await ctx.cron?.schedule(OUTBOX_TASK, { schedule: OUTBOX_SCHEDULE });
}

/** `outbox/status` route body: the admin banner reads `state: "no_transport"`. */
export async function outboxReport(ctx: PluginContext): Promise<OutboxStatusReport> {
	return outboxStatus({ storage: outboxStorage(ctx), email: ctx.email, now: Date.now() });
}
