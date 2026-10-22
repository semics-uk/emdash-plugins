/**
 * Hash-chained audit trail with salted commitments (ES-FR-05, ES-FR-06, ES-NFR-06).
 *
 * Every envelope has one chain of `audit_events`, numbered from `seq = 0`:
 *
 *   hash_n = SHA256(hash_{n-1} ‖ canonical(event_n)),   hash_{-1} = AUDIT_GENESIS (64 zeros)
 *
 * `canonical(event)` is a fixed-order JSON array of the version, envelope id, seq, type, time,
 * actor, the non-personal `data` and the `commitments`, with object keys sorted, so the hash does
 * not depend on how storage orders keys. `prevHash` is fixed-length hex, so the concatenation is
 * unambiguous.
 *
 * **Personal fields** (name, email, participant name, IP, user agent) are never hashed raw. Each becomes a
 * commitment `SHA256(piiSalt ‖ value)` (the envelope's 32-byte random `piiSalt`, as hex) that is
 * hashed into the chain, while the raw value sits beside it in `personal`, outside the hash. The
 * retention purge sets `personal` to null (`purgePersonal`) and the chain still verifies; a value
 * disclosed later (e.g. printed on the certificate) can still be proven against its commitment.
 *
 * **No forks:** an event's id is `<envelopeId>:a<seq, 6 digits>`, and `appendAuditEvent` writes it
 * with a create-only `compareAndSet(id, null, …)`. Two writers that read the same head race for the
 * same id; exactly one wins, and the loser re-reads the head and retries. Each attempt costs two
 * bridge calls (head query + CAS); the default of two attempts keeps a route inside R22.
 *
 * **What the verifier proves:** the events form one unbroken, unedited chain for this envelope.
 * Truncating the tail, or rewriting the whole chain, is only caught against a head recorded
 * elsewhere (the envelope's `finalHash`, the certificate), so pass `head` whenever one exists.
 */
import { err, ok, type RandomBytes, type Result, sha256Hex, toHex, webCryptoRandom } from "@semics-tech/shared";

export const AUDIT_GENESIS = "0".repeat(64);
export const AUDIT_VERSION = 1;

export const AUDIT_EVENT_TYPES = [
	"envelope.created",
	"envelope.sent",
	"signer.viewed",
	"signer.consented",
	"signer.signed",
	"signer.declined",
	"envelope.completed",
	"envelope.declined",
	"envelope.voided",
	"envelope.expired",
] as const;
export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

/** Fields that the retention purge deletes; only their salted commitments are hashed. */
export const PERSONAL_FIELDS = ["name", "email", "participant", "ip", "ua"] as const;
export type PersonalField = (typeof PERSONAL_FIELDS)[number];
export type PersonalValues = { [K in PersonalField]?: string };

/** Non-personal event data: flat primitives only, so canonical JSON is unambiguous. */
export type AuditValue = string | number | boolean | null;

export interface AuditInput {
	type: AuditEventType;
	at: string;
	/** A role or non-personal id (`admin`, `integration`, `signer`, `system`), never an email. */
	actor: string;
	data?: Record<string, AuditValue>;
	personal?: PersonalValues;
}

export interface AuditEventDoc {
	envelopeId: string;
	seq: number;
	type: AuditEventType;
	at: string;
	actor: string;
	data: Record<string, AuditValue>;
	/** `SHA256(piiSalt ‖ value)` per personal field; part of the hash. */
	commitments: Partial<Record<PersonalField, string>>;
	/** The raw personal values, outside the hash; null once purged (or when there were none). */
	personal: PersonalValues | null;
	prevHash: string;
	hash: string;
}

export type AuditChainReason = "ENVELOPE" | "SEQ" | "HASH" | "PREV_HASH" | "COMMITMENT" | "HEAD";

/** `seq` is the chain position that failed (`events.length` for a head mismatch). */
export interface AuditChainError {
	seq: number;
	reason: AuditChainReason;
}

export const PII_SALT_BYTES = 32;

/** A fresh per-envelope `piiSalt`: 32 random bytes as lowercase hex. */
export function newPiiSalt(random: RandomBytes = webCryptoRandom): string {
	return toHex(random(PII_SALT_BYTES));
}

/** The salted commitment of one personal value: `SHA256(piiSalt ‖ value)`. */
export function commitPersonal(salt: string, value: string): Promise<string> {
	return sha256Hex(salt + value);
}

/** Deterministic, seq-sortable storage id: two writers of the same seq collide on it. */
export function auditEventId(envelopeId: string, seq: number): string {
	return `${envelopeId}:a${String(seq).padStart(6, "0")}`;
}

const sortedPairs = (o: Readonly<Record<string, unknown>>) =>
	Object.keys(o)
		.sort()
		.map((k) => [k, o[k]]);

function eventHash(e: Omit<AuditEventDoc, "hash" | "personal">): Promise<string> {
	const canonical = JSON.stringify([
		AUDIT_VERSION,
		e.envelopeId,
		e.seq,
		e.type,
		e.at,
		e.actor,
		sortedPairs(e.data),
		sortedPairs(e.commitments),
	]);
	return sha256Hex(e.prevHash + canonical);
}

/** Builds the event that follows `prev` (or the first event when `prev` is null). */
export async function buildAuditEvent(
	envelopeId: string,
	prev: Pick<AuditEventDoc, "seq" | "hash"> | null,
	input: AuditInput,
	salt: string,
): Promise<AuditEventDoc> {
	const personal = Object.entries(input.personal ?? {}).filter(
		(entry): entry is [PersonalField, string] => typeof entry[1] === "string",
	);
	const commitments: AuditEventDoc["commitments"] = {};
	for (const [field, value] of personal) commitments[field] = await commitPersonal(salt, value);
	const body = {
		envelopeId,
		seq: prev ? prev.seq + 1 : 0,
		type: input.type,
		at: input.at,
		actor: input.actor,
		data: { ...input.data },
		commitments,
		prevHash: prev ? prev.hash : AUDIT_GENESIS,
	};
	return {
		...body,
		personal: personal.length > 0 ? Object.fromEntries(personal) : null,
		hash: await eventHash(body),
	};
}

/**
 * The opening events of a brand-new envelope's chain, from the genesis. Only for an envelope id
 * this writer just created (a fresh UUID, or one whose create-only write it won), so nobody else
 * can be appending; the caller can then write them all in one `putMany`.
 */
export function initialAuditEvents(
	envelopeId: string,
	inputs: readonly AuditInput[],
	salt: string,
): Promise<Array<{ id: string; data: AuditEventDoc }>> {
	return extendAuditChain(envelopeId, null, inputs, salt);
}

/** The events that follow `prev` (null: from the genesis), chained in memory; nothing is written. */
export async function extendAuditChain(
	envelopeId: string,
	prev: Pick<AuditEventDoc, "seq" | "hash"> | null,
	inputs: readonly AuditInput[],
	salt: string,
): Promise<Array<{ id: string; data: AuditEventDoc }>> {
	const out: Array<{ id: string; data: AuditEventDoc }> = [];
	let last: Pick<AuditEventDoc, "seq" | "hash"> | null = prev;
	for (const input of inputs) {
		const event = await buildAuditEvent(envelopeId, last, input, salt);
		out.push({ id: auditEventId(envelopeId, event.seq), data: event });
		last = event;
	}
	return out;
}

/** The slice of the `audit_events` collection an append needs. */
export interface AuditStore {
	query(o: {
		where: { envelopeId: string };
		orderBy: { seq: "desc" };
		limit: 1;
	}): Promise<{ items: Array<{ id: string; data: AuditEventDoc }> }>;
	compareAndSet(id: string, expectedRevision: null, data: AuditEventDoc): Promise<{ applied: boolean }>;
}

/**
 * Appends one event after the stored head with a create-only write (2 bridge calls per attempt).
 * `CONFLICT` means every attempt lost a race; nothing was written, and the chain never forks.
 */
export async function appendAuditEvent(
	store: AuditStore,
	envelopeId: string,
	input: AuditInput,
	options: { salt: string; attempts?: number },
): Promise<Result<AuditEventDoc, "CONFLICT">> {
	const attempts = options.attempts ?? 2;
	for (let attempt = 0; attempt < attempts; attempt++) {
		const { items } = await store.query({ where: { envelopeId }, orderBy: { seq: "desc" }, limit: 1 });
		const event = await buildAuditEvent(envelopeId, items[0]?.data ?? null, input, options.salt);
		const written = await store.compareAndSet(auditEventId(envelopeId, event.seq), null, event);
		if (written.applied) return ok(event);
	}
	return err("CONFLICT");
}

/** The slice a batch write needs: the head query, the create-only write and `putMany`. */
export interface AuditBatchStore extends AuditStore {
	putMany(items: Array<{ id: string; data: AuditEventDoc }>): Promise<void>;
}

/** The current chain head (one bridge call), or null for an empty chain. */
export async function readAuditHead(store: AuditStore, envelopeId: string): Promise<AuditEventDoc | null> {
	const { items } = await store.query({ where: { envelopeId }, orderBy: { seq: "desc" }, limit: 1 });
	return items[0]?.data ?? null;
}

/**
 * Writes events built by `extendAuditChain`: the first with a create-only write (so a writer that
 * raced us for the same position loses), then the rest in one `putMany` (2 calls for any batch).
 * False means the first position was taken: nothing was written, rebuild from a fresh head.
 */
export async function writeAuditEvents(
	store: AuditBatchStore,
	items: ReadonlyArray<{ id: string; data: AuditEventDoc }>,
): Promise<boolean> {
	const [first, ...rest] = items;
	if (!first) return true;
	if (!(await store.compareAndSet(first.id, null, first.data)).applied) return false;
	if (rest.length > 0) await store.putMany(rest);
	return true;
}

async function opensCommitments(e: AuditEventDoc, salt: string): Promise<boolean> {
	for (const [field, value] of Object.entries(e.personal ?? {})) {
		if (e.commitments[field as PersonalField] !== (await commitPersonal(salt, value as string))) return false;
	}
	return true;
}

/**
 * Verifies one envelope's chain, given in seq order (as stored, personal fields purged or not).
 * With `salt`, every raw personal value still present must open its commitment. With `head`, the
 * chain must end there, which catches a truncated or wholly rewritten chain. Returns the head hash
 * (`AUDIT_GENESIS` for an empty chain) and the length.
 */
export async function verifyAuditChain(
	envelopeId: string,
	events: readonly AuditEventDoc[],
	options: { salt?: string; head?: string } = {},
): Promise<Result<{ head: string; length: number }, AuditChainError>> {
	let prev = AUDIT_GENESIS;
	for (const [seq, e] of events.entries()) {
		const fail = (reason: AuditChainReason) => err({ seq, reason });
		if (e.envelopeId !== envelopeId) return fail("ENVELOPE");
		if (e.seq !== seq) return fail("SEQ");
		if ((await eventHash(e)) !== e.hash) return fail("HASH");
		if (e.prevHash !== prev) return fail("PREV_HASH");
		if (options.salt !== undefined && !(await opensCommitments(e, options.salt))) return fail("COMMITMENT");
		prev = e.hash;
	}
	if (options.head !== undefined && options.head !== prev) return err({ seq: events.length, reason: "HEAD" });
	return ok({ head: prev, length: events.length });
}

/** The retention purge of one event: drops the raw personal values, keeps the commitments. */
export function purgePersonal(event: AuditEventDoc): AuditEventDoc {
	return { ...event, personal: null };
}

/** The envelope's `finalHash` (ES-FR-06): binds the signed document's hash to the chain head. */
export function finalEnvelopeHash(docSha256: string, head: string): Promise<string> {
	return sha256Hex(`esign-final/1\n${docSha256}\n${head}`);
}
