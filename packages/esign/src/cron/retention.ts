/**
 * Retention job and deletion on request (ES-FR-22, ES-NFR-06, R28, R45).
 *
 * Two periods, both counted from when the envelope closed (completed, declined, voided, expired; a
 * draft from its last edit). An open envelope (`sent`, `in_progress`) is never touched.
 *
 * 1. `personal` (setting `retentionPersonalDataMonths`, default 12): the personal data goes. On the
 *    audit chain only the raw `personal` values (`purgePersonal`); the commitments stay, so the chain
 *    and `finalHash` still verify. On the envelope `piiSalt` (R28: the commitments, and the salted
 *    signature hash, can no longer be opened or guessed), the `signer` block, `fieldValues` and
 *    `returnUrl`. On the signer the name, email, ip, ua, typed name and strokes, entered values,
 *    decline reason and both token hashes. A draft is deleted outright with its events.
 * 2. `records` (setting `retentionSignedRecordsYears`, default 7): the signed record goes: PDF
 *    chunks (`artifacts`), snapshot chunks, the chain and the signer. The envelope stays as a
 *    tombstone without title or `pdfSha256` (so `/verify` no longer matches the PDF), which keeps the
 *    `(clientId, externalRef)` attempt numbering and storage cursors intact.
 * 3. `outbox`: sent and failed rows older than the personal period (they hold the recipient).
 *
 * Until the records period ends the signed PDF, snapshot and chain keep what they printed (the
 * signer's name and IP on the certificate, `{{signer.name}}` in the text): they are the signed record.
 * Consumed `nonces` are already deleted hourly by `nonce-sweep` (T061).
 *
 * The daily `retention` task runs a pass a page at a time (keyset cursor in KV, as Events T087); each
 * page takes two ticks so every tick stays within 8 bridge calls, and while the pass has more to do
 * it queues the one-shot `retention-more` for the next minute's tick. The clock is passed in.
 */
import { toIso } from "@semics-tech/shared";
import type { PluginContext } from "emdash/plugin";
import { purgePersonal } from "../domain/audit";
import type { EnvelopeDoc, SignerDoc } from "../domain/envelopes";
import { stores } from "../routes/envelopes";

export const RETENTION_TASK = "retention";
export const RETENTION_MORE_TASK = "retention-more";
export const RETENTION_SCHEDULE = "23 3 * * *";
export const RETENTION_STATE_KEY = "cron:retention";
/** Envelopes per page. */
export const RETENTION_PAGE = 10;
const AUDIT_PAGE = 100;

type Item = { id: string; data: EnvelopeDoc };
type S = ReturnType<typeof stores>;

const isOpen = (e: EnvelopeDoc) => e.status === "sent" || e.status === "in_progress";
/** When the envelope stopped changing; null while it is open. */
const closedMs = (e: EnvelopeDoc) => (isOpen(e) ? null : Date.parse(e.completedAt ?? e.closedAt ?? e.updatedAt));

const setting = (entries: Array<{ key: string; value: unknown }>, key: string, dflt: number, max: number) => {
	const v = entries.find((e) => e.key === key)?.value;
	return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(1, Math.round(v))) : dflt;
};

/** The pass's cutoffs (ms): personal data and signed records closed before them are due. */
export function retentionCutoffs(entries: Array<{ key: string; value: unknown }>, now: number) {
	const p = new Date(now);
	p.setUTCMonth(p.getUTCMonth() - setting(entries, "retentionPersonalDataMonths", 12, 120));
	const r = new Date(now);
	r.setUTCFullYear(r.getUTCFullYear() - setting(entries, "retentionSignedRecordsYears", 7, 50));
	// Personal data never outlives the signed record that carries it.
	return { p: Math.max(p.getTime(), r.getTime()), r: r.getTime() };
}

function scrubSigner(id: string, s: SignerDoc): SignerDoc {
	const { name, email, ip, ua, signature, fieldValues, declineReason, copyTokenHash, participant, ...keep } = s;
	// `tokenHash` is a unique index: a value no SHA-256 hex can equal.
	return {
		...keep,
		name: "",
		email: "",
		tokenHash: `purged:${id}`,
		...(signature ? { signature: { kind: signature.kind, sha256: signature.sha256 } } : {}),
	};
}

function scrubEnvelope(e: EnvelopeDoc, at: string): EnvelopeDoc {
	const { piiSalt, returnUrl, ...keep } = e;
	return {
		...keep,
		signer: { name: "", email: "", as: e.signer.as },
		fieldValues: {},
		personalPurgedAt: at,
	} as EnvelopeDoc;
}

/**
 * Purges one audit page of these envelopes (drafts: deletes it). 2 calls (query + write), 3 when
 * the page mixes drafts and closed envelopes. Returns the next page's cursor, if any.
 */
async function purgeAudit(st: S, items: Item[], cursor?: string) {
	const drafts = new Set(items.filter((i) => i.data.status === "draft").map((i) => i.id));
	const page = await st.audit_events.query({
		where: { envelopeId: { in: items.map((i) => i.id) } },
		limit: AUDIT_PAGE,
		...(cursor ? { cursor } : {}),
	});
	const put = page.items.filter((e) => !drafts.has(e.data.envelopeId) && e.data.personal !== null);
	const del = page.items.filter((e) => drafts.has(e.data.envelopeId)).map((e) => e.id);
	if (put.length > 0) await st.audit_events.putMany(put.map((e) => ({ id: e.id, data: purgePersonal(e.data) })));
	if (del.length > 0) await st.audit_events.deleteMany(del);
	return page.hasMore ? page.cursor : undefined;
}

/** Scrubs the envelopes and their signers (≤ 3 calls, 4 with drafts). */
async function scrubRecords(st: S, items: Item[], now: number) {
	const at = toIso(now);
	const closed = items.filter((i) => i.data.status !== "draft");
	const ids = closed.flatMap((i) => i.data.signerIds);
	const found = ids.length > 0 ? await st.signers.getMany(ids) : new Map<string, SignerDoc>();
	const scrubbed = ids.flatMap((id) => {
		const s = found.get(id);
		return s ? [{ id, data: scrubSigner(id, s) }] : [];
	});
	if (scrubbed.length > 0) await st.signers.putMany(scrubbed);
	if (closed.length > 0) await st.envelopes.putMany(closed.map((i) => ({ id: i.id, data: scrubEnvelope(i.data, at) })));
	const drafts = items.filter((i) => i.data.status === "draft").map((i) => i.id);
	if (drafts.length > 0) await st.envelopes.deleteMany(drafts);
}

/** What the job keeps in KV between ticks. */
export interface RetentionState {
	phase?: "personal" | "records" | "outbox";
	/** 1: the current page's second tick. */
	step?: 1;
	/** This pass's cutoffs (ms). */
	p?: number;
	r?: number;
	/** The cursor that reads the current page, and the audit cursor inside it. */
	cursor?: string;
	acursor?: string;
	/** Per phase: envelopes created before this are done; the next pass starts there. */
	pf?: string;
	rf?: string;
	/** The oldest `createdAt` this pass had to leave (open or not yet due): the next floor. */
	keep?: string;
}

/** One `retention` tick: ≤ 8 bridge calls. Returns whether the pass is finished. */
export async function retentionTick(ctx: PluginContext, now: number): Promise<boolean> {
	const st = stores(ctx);
	const s: RetentionState = { ...(await ctx.kv.get<RetentionState>(RETENTION_STATE_KEY)) };
	let idle = false;

	if (!s.phase) {
		Object.assign(s, retentionCutoffs(await ctx.settings.list("retention"), now), { phase: "personal" });
	} else if (s.phase === "outbox") {
		const page = await st.outbox.query({
			where: { status: { in: ["sent", "failed"] }, nextAttemptAt: { lt: s.p } },
			limit: AUDIT_PAGE,
		});
		if (page.items.length > 0) await st.outbox.deleteMany(page.items.map((i) => i.id));
		idle = !page.hasMore;
	} else {
		const personal = s.phase === "personal";
		const cutoff = (personal ? s.p : s.r) as number;
		const page = await st.envelopes.query({
			where: { createdAt: { gte: (personal ? s.pf : s.rf) ?? "", lt: toIso(cutoff) } },
			limit: RETENTION_PAGE,
			...(s.cursor ? { cursor: s.cursor } : {}),
		});
		const done = (e: EnvelopeDoc) => (personal ? e.personalPurgedAt : e.recordsPurgedAt);
		const due = page.items.filter(({ data }) => !done(data) && (closedMs(data) ?? cutoff) < cutoff);
		let next = due.length === 0;
		if (!s.step && due.length > 0) {
			if (personal) s.acursor = await purgeAudit(st, due, s.acursor);
			else {
				const events = await st.audit_events.query({
					where: { envelopeId: { in: due.map((i) => i.id) } },
					limit: AUDIT_PAGE,
				});
				if (events.items.length > 0) await st.audit_events.deleteMany(events.items.map((e) => e.id));
				if (events.hasMore) s.acursor = "more";
				else {
					delete s.acursor;
					const pdf = due.flatMap((i) => i.data.pdf?.ids ?? []);
					const chunks = due.flatMap((i) => i.data.snapshot?.ids ?? []);
					if (pdf.length > 0) await st.artifacts.deleteMany(pdf);
					if (chunks.length > 0) await st.snapshots.deleteMany(chunks);
				}
			}
			if (!s.acursor) s.step = 1;
		} else if (due.length > 0) {
			if (personal) await scrubRecords(st, due, now);
			else {
				const signerIds = due.flatMap((i) => i.data.signerIds);
				if (signerIds.length > 0) await st.signers.deleteMany(signerIds);
				const at = toIso(now);
				await st.envelopes.putMany(
					due.map(({ id, data }) => ({
						id,
						data: {
							...data,
							title: "",
							signerIds: [],
							snapshot: null,
							pdf: null,
							pdfSha256: null,
							recordsPurgedAt: at,
						},
					})),
				);
			}
			next = true;
		}
		if (next) {
			delete s.step;
			for (const { data } of page.items) {
				if (!done(data) && !due.some((d) => d.data === data) && (!s.keep || data.createdAt < s.keep))
					s.keep = data.createdAt;
			}
			if (page.hasMore && page.cursor) s.cursor = page.cursor;
			else {
				s[personal ? "pf" : "rf"] = s.keep ?? toIso(cutoff);
				delete s.cursor;
				delete s.keep;
				s.phase = personal ? "records" : "outbox";
			}
		}
	}

	if (idle) delete s.phase;
	await ctx.kv.set(RETENTION_STATE_KEY, s);
	if (!idle) await ctx.cron?.schedule(RETENTION_MORE_TASK, { schedule: toIso(now) });
	return idle;
}

/** The `cron` hook's share: `retention` and its one-shot follow-up. True when the event was ours. */
export async function runRetentionJob(event: { name: string }, ctx: PluginContext, now = Date.now()): Promise<boolean> {
	if (event.name !== RETENTION_TASK && event.name !== RETENTION_MORE_TASK) return false;
	await retentionTick(ctx, now);
	return true;
}

/** Open, or completed with its signed PDF still being made (the PDF needs the signer's details). */
const waits = (e: EnvelopeDoc) => isOpen(e) || (e.status === "completed" && !e.pdfSha256);

/** Envelopes per on-request deletion. */
const ON_REQUEST = 10;

export interface Lookup {
	/** Closed envelopes whose personal data is still there. */
	due: Item[];
	open: number;
}

/** The envelopes of one signer email (via `signers`) or one envelope id. 2 calls. */
export async function findForErasure(ctx: PluginContext, subject: string): Promise<Lookup> {
	const st = stores(ctx);
	let items: Item[];
	if (subject.includes("@")) {
		const found = await st.signers.query({ where: { email: subject.toLowerCase() }, limit: ON_REQUEST });
		const envs = await st.envelopes.getMany([...new Set(found.items.map((i) => i.data.envelopeId))]);
		items = [...envs].map(([id, data]) => ({ id, data }));
	} else {
		const env = await st.envelopes.get(subject);
		items = env ? [{ id: subject, data: env }] : [];
	}
	return {
		due: items.filter((i) => !waits(i.data) && !i.data.personalPurgedAt),
		open: items.filter((i) => waits(i.data)).length,
	};
}

/**
 * Deletion on request (ES-FR-22): the personal-data purge for these envelopes now, whatever their
 * period; the signed record keeps its own period. Also deletes their outbox rows. 6 calls (8 with a
 * second audit page, for long chains). Throws when the chains are longer still (more than 200 events
 * for 10 envelopes, which Free never writes): the purged events stay purged and nothing else changes.
 * Only for envelopes `findForErasure` listed as due (2 calls): 8 per click at most.
 */
export async function eraseOnRequest(ctx: PluginContext, found: Lookup, now: number): Promise<void> {
	const st = stores(ctx);
	let cursor = await purgeAudit(st, found.due);
	if (cursor) cursor = await purgeAudit(st, found.due, cursor);
	if (cursor) throw new Error("audit trail too long for one request");
	await scrubRecords(st, found.due, now);
	await st.outbox.deleteMany(
		found.due.flatMap((i) => [`complete-${i.id}`, ...i.data.signerIds.map((sid) => `invite-${sid}`)]),
	);
}
