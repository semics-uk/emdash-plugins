/**
 * The nonce sweep (T061, SX-NFR-03; protocol §6.1: keep a consumed nonce at least until `exp` + 60 s).
 *
 * `public/envelopes/from-intent` records each consumed intent nonce as the create-only document
 * `nonces/<cid>.<nonce>` with ISO `expiresAt` = `exp` + 60 s. After that the intent itself is
 * expired (step 7 rejects it before the nonce is looked at), so the document is dead weight.
 *
 * `nonce-sweep` runs hourly (a recurring task in `RECURRING_TASKS`, scheduled by T116's
 * self-scheduling). Each tick deletes lapsed nonces oldest first, a page at a time: one query and
 * one `deleteMany` per page, at most `NONCE_SWEEP_PAGES` pages, so 6 bridge calls. With a backlog
 * left it schedules the one-shot `nonce-sweep-more` a minute later (1 call, 7 in all, target 8,
 * R22), which runs the same job. Nonces are created at most one per intent, so a backlog only
 * builds up after a burst or a long outage; the recurring tick would clear it anyway.
 */
import { toIso } from "@semics-tech/shared";
import type { CronEvent, PluginContext } from "emdash/plugin";

export const NONCE_SWEEP_TASK = "nonce-sweep";
export const NONCE_SWEEP_MORE_TASK = "nonce-sweep-more";
export const NONCE_SWEEP_SCHEDULE = "0 * * * *";
/** Nonces deleted per page (one query + one deleteMany). */
export const NONCE_SWEEP_PAGE = 100;
/** Pages per invocation: 2 calls each, plus 1 for the continuation, stays within 8. */
export const NONCE_SWEEP_PAGES = 3;
const CONTINUE_AFTER_MS = 60_000;

export interface NonceSweepStore {
	query(o: {
		where: { expiresAt: { lt: string } };
		orderBy: { expiresAt: "asc" };
		limit: number;
	}): Promise<{ items: Array<{ id: string }>; hasMore?: boolean }>;
	deleteMany(ids: string[]): Promise<number>;
}

export interface NonceSweepDeps {
	nonces: NonceSweepStore;
	cron?: { schedule(name: string, opts: { schedule: string }): Promise<void> } | undefined;
	/** Epoch milliseconds. */
	now: number;
	page?: number;
	pages?: number;
}

export interface NonceSweepReport {
	deleted: number;
	/** Lapsed nonces remain after this invocation. */
	more: boolean;
}

/** One sweep: deletes nonces whose `expiresAt` is before `now`, oldest first. */
export async function sweepNonces(deps: NonceSweepDeps): Promise<NonceSweepReport> {
	const { nonces, cron, now, page = NONCE_SWEEP_PAGE, pages = NONCE_SWEEP_PAGES } = deps;
	const before = toIso(now);
	let deleted = 0;
	let more = false;
	for (let i = 0; i < pages; i++) {
		const due = await nonces.query({
			where: { expiresAt: { lt: before } },
			orderBy: { expiresAt: "asc" },
			limit: page,
		});
		if (due.items.length === 0) break;
		deleted += await nonces.deleteMany(due.items.map((n) => n.id));
		more = due.hasMore === true;
		if (!more) break;
	}
	if (more) await cron?.schedule(NONCE_SWEEP_MORE_TASK, { schedule: toIso(now + CONTINUE_AFTER_MS) });
	return { deleted, more };
}

/** The `cron` hook's share for the sweep; true when `event` was ours. */
export async function runNonceSweepJob(event: CronEvent, ctx: PluginContext): Promise<boolean> {
	if (event.name !== NONCE_SWEEP_TASK && event.name !== NONCE_SWEEP_MORE_TASK) return false;
	const nonces = (ctx.storage as unknown as { nonces: NonceSweepStore }).nonces;
	await sweepNonces({ nonces, cron: ctx.cron, now: Date.now() });
	return true;
}
