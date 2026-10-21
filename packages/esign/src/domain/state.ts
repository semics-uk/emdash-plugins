/**
 * Envelope status machine (ES-FR-03): the single source of truth for which status changes are
 * legal. Routes and cron jobs change an envelope's status only through `transitionEnvelope`, which
 * checks this table and then writes with a guarded update on the expected current status, so two
 * concurrent writers can never both win (e.g. a submit racing the expiry job).
 *
 *   draft ──► sent ──► in_progress ──► completed
 *     │         │            │
 *     │         ├────────────┴──► declined | voided | expired
 *     └──► voided            (sent can also go straight to completed: one signer)
 *
 * `completed`, `declined`, `voided` and `expired` are terminal.
 */
import { err, ok, type Result } from "@semics-tech/shared";

export const ENVELOPE_STATUSES = [
	"draft",
	"sent",
	"in_progress",
	"completed",
	"declined",
	"voided",
	"expired",
] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

const CLOSING = ["declined", "voided", "expired"] as const;

export const TRANSITIONS: Readonly<Record<EnvelopeStatus, readonly EnvelopeStatus[]>> = Object.freeze({
	draft: ["sent", "voided"],
	sent: ["in_progress", "completed", ...CLOSING],
	in_progress: ["completed", ...CLOSING],
	completed: [],
	declined: [],
	voided: [],
	expired: [],
});

export function isEnvelopeStatus(value: unknown): value is EnvelopeStatus {
	return typeof value === "string" && (ENVELOPE_STATUSES as readonly string[]).includes(value);
}

export function canTransition(from: unknown, to: unknown): boolean {
	return isEnvelopeStatus(from) && isEnvelopeStatus(to) && TRANSITIONS[from].includes(to);
}

export function isTerminal(status: EnvelopeStatus): boolean {
	return TRANSITIONS[status].length === 0;
}

/** `ILLEGAL_TRANSITION`: the table forbids it. `CONFLICT`: the stored status was not `from` (or the row is gone). */
export type TransitionError = "ILLEGAL_TRANSITION" | "CONFLICT";

/** The slice of a storage collection a transition needs (`StorageCollection.updateIf`). */
export interface TransitionStore<T> {
	updateIf(
		id: string,
		args: { where: Record<string, unknown>; set?: Partial<T> },
	): Promise<{ applied: true; data: T } | { applied: false }>;
}

/** Moves envelope `id` from `from` to `to`, merging `set`, in one guarded update (one bridge call). */
export async function transitionEnvelope<T extends { status: EnvelopeStatus }>(
	store: TransitionStore<T>,
	id: string,
	from: EnvelopeStatus,
	to: EnvelopeStatus,
	set: Partial<T> = {},
): Promise<Result<T, TransitionError>> {
	if (!canTransition(from, to)) return err("ILLEGAL_TRANSITION");
	const result = await store.updateIf(id, { where: { status: from }, set: { ...set, status: to } });
	return result.applied ? ok(result.data) : err("CONFLICT");
}
