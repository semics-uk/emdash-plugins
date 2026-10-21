/**
 * The signed-PDF job (ES-FR-07, T025): a one-shot cron task `signed-pdf-<envelopeId>` (task names allow only letters, digits, `-` and `_`, as envelope ids do) that
 * `public/submit` schedules at completion. The submit route already spends 8 bridge calls, so the
 * PDF is rendered here, on the next cron tick, rather than inline.
 *
 * The job renders from what is stored, once: the frozen snapshot, the signer's signature and the
 * whole audit chain, which must verify and end at the head the envelope's `finalHash` covers (a
 * submit that is still writing its last events, or correcting `finalHash` after a race, makes the
 * job re-arm itself a minute later instead). It hashes the bytes, writes the chunks and records
 * `pdfSha256` with a guarded update, so a PDF is recorded at most once.
 *
 * Bridge calls (R22 target ≤ 8): envelope (1); signer, snapshot chunks and audit chain together
 * (3); chunk `putMany` (1); guarded envelope update (1) = 6. A re-arm is envelope + 3 reads + one
 * schedule = 5. A job for an envelope that already has its PDF stops after the first read.
 */
import type { CronEvent, PluginContext } from "emdash/plugin";
import { type AuditEventDoc, finalEnvelopeHash, verifyAuditChain } from "../domain/audit";
import { joinSnapshot } from "../domain/envelopes";
import { pdfChunks, renderSignedPdf } from "../domain/pdf";
import { stores } from "../routes/envelopes";

export const PDF_TASK_PREFIX = "signed-pdf-";
/** Re-arms after which a job whose chain never settles gives up (and logs). */
export const PDF_MAX_ATTEMPTS = 5;
const RETRY_MS = 60_000;
/** A Free envelope has a handful of events; far more means something is wrong. */
const MAX_EVENTS = 100;

export const pdfTaskName = (envelopeId: string) => `${PDF_TASK_PREFIX}${envelopeId}`;

export interface PdfCron {
	schedule(name: string, opts: { schedule: string; data?: Record<string, unknown> }): Promise<void>;
}

/** Schedules (or re-arms) the job for `envelopeId` at `at` (one bridge call). */
export function schedulePdfJob(cron: PdfCron | undefined, envelopeId: string, at: number, attempt = 0) {
	return cron?.schedule(pdfTaskName(envelopeId), {
		schedule: new Date(at).toISOString(),
		data: { envelopeId, attempt },
	});
}

export type PdfJobResult = "stored" | "skipped" | "retry" | "gave-up";

/** Renders and stores the signed PDF of a completed envelope. */
export async function generateSignedPdf(
	ctx: PluginContext,
	envelopeId: string,
	options: { now: number; attempt?: number },
): Promise<PdfJobResult> {
	const { envelopes, signers, snapshots, audit_events, artifacts } = stores(ctx);
	const envelope = await envelopes.get(envelopeId);
	if (!envelope || envelope.status !== "completed" || envelope.pdfSha256) return "skipped";
	const signerId = envelope.signerIds[0];
	if (!signerId || !envelope.snapshot || !envelope.docSha256) return "skipped";

	const [signer, chunks, chain] = await Promise.all([
		signers.get(signerId),
		snapshots.getMany(envelope.snapshot.ids),
		audit_events.query({ where: { envelopeId }, orderBy: { seq: "asc" }, limit: MAX_EVENTS }),
	]);
	const snapshot = joinSnapshot([...chunks.values()]);
	const events: AuditEventDoc[] = chain.items.map((item) => item.data);
	const verified = await verifyAuditChain(envelopeId, events);
	const settled =
		verified.ok &&
		events.at(-1)?.type === "envelope.completed" &&
		(await finalEnvelopeHash(envelope.docSha256, verified.value.head)) === envelope.finalHash;
	if (!signer || signer.status !== "signed" || snapshot === null || !verified.ok || !settled) {
		const attempt = options.attempt ?? 0;
		if (attempt + 1 >= PDF_MAX_ATTEMPTS) {
			ctx.log.error("signed PDF not generated: the envelope never settled", { envelopeId });
			return "gave-up";
		}
		await schedulePdfJob(ctx.cron, envelopeId, options.now + RETRY_MS, attempt + 1);
		return "retry";
	}

	const { bytes, sha256 } = await renderSignedPdf({
		envelopeId,
		envelope,
		signer,
		snapshot,
		events,
		head: verified.value.head,
	});
	const items = pdfChunks(envelopeId, bytes, sha256);
	await artifacts.putMany(items);
	const recorded = await envelopes.updateIf(envelopeId, {
		where: { status: "completed", pdfSha256: null },
		set: {
			pdfSha256: sha256,
			pdf: { ids: items.map((item) => item.id), bytes: bytes.length },
			updatedAt: new Date(options.now).toISOString(),
		},
	});
	return recorded.applied ? "stored" : "skipped";
}

/** The `cron` hook's share for this job; true when `event` was one of ours. */
export async function runPdfJob(event: CronEvent, ctx: PluginContext): Promise<boolean> {
	if (!event.name.startsWith(PDF_TASK_PREFIX)) return false;
	const envelopeId = event.data?.envelopeId;
	const attempt = event.data?.attempt;
	if (typeof envelopeId !== "string" || envelopeId.length === 0) return true;
	await generateSignedPdf(ctx, envelopeId, {
		now: Date.now(),
		attempt: typeof attempt === "number" && Number.isSafeInteger(attempt) ? attempt : 0,
	});
	return true;
}
