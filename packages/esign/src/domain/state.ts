/**
 * Envelope status machine (ES-FR-03). Red-phase stub: the table and functions land in green.
 */
import type { Result } from "@semics-tech/shared";

export const ENVELOPE_STATUSES = ["draft", "sent", "in_progress", "completed", "declined", "voided", "expired"] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];

export const TRANSITIONS: Readonly<Record<EnvelopeStatus, readonly EnvelopeStatus[]>> = {
	draft: [],
	sent: [],
	in_progress: [],
	completed: [],
	declined: [],
	voided: [],
	expired: [],
};

export function canTransition(_from: unknown, _to: unknown): boolean {
	throw new Error("not implemented");
}

export function isTerminal(_status: EnvelopeStatus): boolean {
	throw new Error("not implemented");
}

export type TransitionError = "ILLEGAL_TRANSITION" | "CONFLICT";

export interface TransitionStore<T> {
	updateIf(
		id: string,
		args: { where: Record<string, unknown>; set?: Partial<T> },
	): Promise<{ applied: true; data: T } | { applied: false }>;
}

export async function transitionEnvelope<T extends { status: EnvelopeStatus }>(
	_store: TransitionStore<T>,
	_id: string,
	_from: EnvelopeStatus,
	_to: EnvelopeStatus,
	_set?: Partial<T>,
): Promise<Result<T, TransitionError>> {
	throw new Error("not implemented");
}
