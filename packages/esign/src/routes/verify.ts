/**
 * `public/verify` (ES-FR-09, ES-US-6): does this SHA-256 belong to a completed envelope's signed PDF?
 *
 * Input `{ sha256 }` (64 hex, any case). The answer is public, so it carries only what a verifier needs:
 * `matched`, and when matched the status, completion time, `finalHash` and whether the audit chain
 * verifies. Never names, emails, ids, salts, tokens or ip data. An unknown hash is just
 * `{ matched: false }`.
 *
 * `chainVerified` re-runs `verifyAuditChain` over the stored events and checks that
 * `finalEnvelopeHash(docSha256, head)` equals the recorded `finalHash` (the recorded head is stored only
 * folded into `finalHash`, so that is how it is enforced). It is `null` when the chain is longer than
 * one page of events and so was not checked.
 *
 * Per-IP rate limit (`rateLimit`, 20 per 10 minutes). Bridge calls: limiter (2), envelope by
 * `pdfSha256` (1), events (1) = 4 (R22 target ≤ 8).
 */
import { type RateLimitStore, rateLimit } from "@semics-tech/shared";
import type { RouteHandler } from "emdash/plugin";
import { type AuditEventDoc, finalEnvelopeHash, verifyAuditChain } from "../domain/audit";
import { badRequest, fail, obj, stores } from "./envelopes";

const SHA256 = /^[0-9a-f]{64}$/;
const MAX_EVENTS = 100;
const LIMIT = 20;
const WINDOW_SECONDS = 600;
const RATE_SALT = "esign-verify/1";

export const verifyHandler: RouteHandler = async (routeCtx, ctx) => {
	const raw = obj(routeCtx.input).sha256;
	const sha256 = typeof raw === "string" ? raw.toLowerCase() : "";
	if (!SHA256.test(sha256)) return badRequest([{ path: "sha256", code: "invalid" }]);

	const kv: RateLimitStore = { get: (key) => ctx.kv.get<string>(key), set: (key, value) => ctx.kv.set(key, value) };
	const ip = (routeCtx as { requestMeta?: { ip?: string | null } }).requestMeta?.ip ?? "unknown";
	const limited = await rateLimit(kv, ip, Date.now(), {
		scope: "esign-verify",
		limit: LIMIT,
		windowSeconds: WINDOW_SECONDS,
		salt: RATE_SALT,
	});
	if (!limited.ok) return fail("RATE_LIMITED");

	const { envelopes, audit_events } = stores(ctx);
	const hit = (await envelopes.query({ where: { pdfSha256: sha256 }, limit: 1 })).items[0];
	if (!hit || hit.data.status !== "completed") return { ok: true, matched: false };
	const found = hit.data;

	const { items } = await audit_events.query({
		where: { envelopeId: hit.id },
		orderBy: { seq: "asc" },
		limit: MAX_EVENTS + 1,
	});
	let chainVerified: boolean | null = null;
	if (items.length <= MAX_EVENTS) {
		const events: AuditEventDoc[] = items.map((item) => item.data);
		const chain = await verifyAuditChain(hit.id, events);
		chainVerified =
			chain.ok &&
			found.docSha256 !== null &&
			events.at(-1)?.type === "envelope.completed" &&
			(await finalEnvelopeHash(found.docSha256, chain.value.head)) === found.finalHash;
	}
	return {
		ok: true,
		matched: true,
		status: found.status,
		completedAt: found.completedAt,
		finalHash: found.finalHash,
		chainVerified,
	};
};
