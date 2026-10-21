/**
 * Email outbox: queue mail in the `outbox` storage collection and deliver it from cron in bounded
 * batches with exponential backoff. Storage, email transport and time are injected.
 *
 * Budget (R22): a tick makes 1 query + one `email.send` per message + 1 `putMany`, so with the
 * default cap of 6 messages it uses 8 bridge calls. Enqueueing is a single `put`.
 * Cron ticks run about once a minute and can be ~62 s late (R23), so the first backoff is 60 s and
 * `nextAttemptAt <= now` is the only due test; lateness just delays a retry.
 */

export const OUTBOX_MAX_ATTEMPTS = 5;
export const OUTBOX_BACKOFF_BASE_MS = 60_000;
export const OUTBOX_BACKOFF_MAX_MS = 3_600_000;
/** 1 query + 6 sends + 1 putMany = 8 calls. */
export const OUTBOX_DEFAULT_MAX_PER_TICK = 6;

/** Plugin storage declaration for the collection. */
export const OUTBOX_COLLECTION = {
	name: "outbox",
	indexes: [["status", "nextAttemptAt"]] as readonly (readonly string[])[],
} as const;

export interface OutboxMessage {
	readonly to: string;
	readonly subject: string;
	readonly text: string;
	readonly html?: string;
}

/** What a `sent` or `failed` row keeps of its message: the body, HTML and any payload are dropped (R32). */
export interface ScrubbedMessage {
	readonly to: string;
	readonly subject: string;
	readonly kind?: string;
}

export type OutboxStatus = "pending" | "sent" | "failed";

export interface OutboxRecord {
	readonly message: OutboxMessage | ScrubbedMessage;
	readonly status: OutboxStatus;
	readonly attempts: number;
	readonly nextAttemptAt: number;
	readonly createdAt: number;
	readonly lastError?: string;
	readonly sentAt?: number;
}

export interface OutboxStorage {
	put(id: string, data: OutboxRecord): Promise<void>;
	putMany(items: readonly { id: string; data: OutboxRecord }[]): Promise<void>;
	/** Rows with `status`, and `nextAttemptAt <= nextAttemptAtLte` when given, oldest first. */
	query(q: { status: OutboxStatus; nextAttemptAtLte?: number; limit: number }): Promise<{
		items: readonly { id: string; data: OutboxRecord }[];
	}>;
}

export interface OutboxEmail {
	send(message: OutboxMessage): Promise<unknown>;
}

/**
 * Keeps only `to`, `subject` and `kind`. Queued bodies can carry credentials (E-sign's clear-text
 * signing token), so a row that is done is rewritten without them in the same `putMany` (R32).
 */
export function scrubMessage(message: OutboxMessage | ScrubbedMessage): ScrubbedMessage {
	const kind = (message as ScrubbedMessage).kind;
	return { to: message.to, subject: message.subject, ...(typeof kind === "string" ? { kind } : {}) };
}

export async function enqueueEmail(
	storage: OutboxStorage,
	message: OutboxMessage,
	now: number,
	newId: () => string,
): Promise<string> {
	const id = newId();
	await storage.put(id, { message, status: "pending", attempts: 0, nextAttemptAt: now, createdAt: now });
	return id;
}

/** Delay before the next try, given the number of failures so far (1-based). */
export function backoffMs(failures: number): number {
	return Math.min(OUTBOX_BACKOFF_BASE_MS * 2 ** (failures - 1), OUTBOX_BACKOFF_MAX_MS);
}

export interface DrainOptions {
	readonly storage: OutboxStorage;
	/** `ctx.email`; absent when no transport is configured. */
	readonly email: OutboxEmail | undefined;
	readonly now: number;
	readonly maxPerTick?: number;
}

export interface DrainResult {
	readonly sent: number;
	readonly failed: number;
	readonly gaveUp: number;
	/** True when the cap cut the batch short, so more may be due. */
	readonly remainingHint: boolean;
}

export async function drainOutbox(opts: DrainOptions): Promise<DrainResult> {
	const empty = { sent: 0, failed: 0, gaveUp: 0, remainingHint: false };
	if (!opts.email) return empty;
	const cap = Math.max(1, opts.maxPerTick ?? OUTBOX_DEFAULT_MAX_PER_TICK);
	const { items } = await opts.storage.query({ status: "pending", nextAttemptAtLte: opts.now, limit: cap + 1 });
	if (items.length === 0) return empty;
	const updates: { id: string; data: OutboxRecord }[] = [];
	let sent = 0;
	let failed = 0;
	let gaveUp = 0;
	for (const { id, data } of items.slice(0, cap)) {
		const attempts = data.attempts + 1;
		try {
			await opts.email.send(data.message as OutboxMessage);
			sent++;
			const message = scrubMessage(data.message);
			updates.push({ id, data: { ...data, message, status: "sent", attempts, sentAt: opts.now } });
		} catch (e) {
			const lastError = (e instanceof Error ? e.message : String(e)).slice(0, 300);
			if (attempts >= OUTBOX_MAX_ATTEMPTS) {
				gaveUp++;
				updates.push({
					id,
					data: { ...data, message: scrubMessage(data.message), status: "failed", attempts, lastError },
				});
			} else {
				failed++;
				updates.push({ id, data: { ...data, attempts, lastError, nextAttemptAt: opts.now + backoffMs(attempts) } });
			}
		}
	}
	await opts.storage.putMany(updates);
	return { sent, failed, gaveUp, remainingHint: items.length > cap };
}

export interface OutboxStatusReport {
	readonly state: "ok" | "no_transport";
	readonly pending: number;
	readonly failed: number;
}

/** For the admin banner. Costs 2 storage calls. Counts are capped at 100 each. */
export async function outboxStatus(opts: Omit<DrainOptions, "maxPerTick">): Promise<OutboxStatusReport> {
	const [pending, failed] = await Promise.all([
		opts.storage.query({ status: "pending", limit: 100 }),
		opts.storage.query({ status: "failed", limit: 100 }),
	]);
	return {
		state: opts.email ? "ok" : "no_transport",
		pending: pending.items.length,
		failed: failed.items.length,
	};
}
