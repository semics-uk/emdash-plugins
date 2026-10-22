/**
 * `public/download` (ES-FR-08, T025): serves the stored signed PDF byte for byte.
 *
 * The link is a short-lived signed link (`signLink`/`verifyLink` from shared, purpose
 * `esign/download`, 15 minutes) carrying only the envelope id: never the signing token. Links are
 * minted by routes that already know the caller may have the PDF: `public/session` for the signer
 * of a completed envelope and the admin `envelopes/get`. The HMAC key is 32 random bytes kept in
 * KV (hex), created on first use with a create-only write.
 *
 * The route returns the stored chunks joined, after checking they hash to `pdfSha256`; it never
 * re-renders. A completed envelope whose PDF is not stored yet gets `SIGNED_PDF_PENDING` and its
 * job re-armed (in case the one-shot was lost).
 *
 * Bridge calls: link key (1), envelope (1), chunks (1) = 3; pending: key, envelope, schedule = 3.
 */
import {
	type ErrorCode,
	LINK_SECRET_BYTES,
	sha256Hex,
	signLink,
	toHex,
	toRouteError,
	verifyLink,
} from "@semics-tech/shared";
import { type PluginContext, pluginResponse, type RouteHandler } from "emdash/plugin";
import { schedulePdfJob } from "../cron/pdf";
import { joinPdf } from "../domain/pdf";
import { stores } from "./envelopes";

export const DOWNLOAD_PURPOSE = "esign/download";
export const DOWNLOAD_TTL_MS = 15 * 60 * 1000;
export const LINK_KEY = "esign:download-link-key";
const ID_PATTERN = /^[A-Za-z0-9_:.-]{1,200}$/;

interface LinkKv {
	get<T>(key: string): Promise<T | null>;
	compareAndSet(key: string, expectedRevision: string | null, value: unknown): Promise<{ applied: boolean }>;
}

const KEY_HEX = new RegExp(`^[0-9a-f]{${LINK_SECRET_BYTES * 2}}$`);

/** The stored key (hex), or null when absent or malformed. */
function decodeKey(value: unknown): Uint8Array | null {
	if (typeof value !== "string" || !KEY_HEX.test(value)) return null;
	return Uint8Array.from(value.match(/../g) as string[], (h) => Number.parseInt(h, 16));
}

/** The download-link HMAC key: read (1 call), or created once (+1 write, +1 read if we lost the race). */
export async function linkSecret(kv: LinkKv): Promise<Uint8Array> {
	const stored = decodeKey(await kv.get<string>(LINK_KEY));
	if (stored) return stored;
	const fresh = crypto.getRandomValues(new Uint8Array(LINK_SECRET_BYTES));
	if ((await kv.compareAndSet(LINK_KEY, null, toHex(fresh))).applied) return fresh;
	const winner = decodeKey(await kv.get<string>(LINK_KEY));
	if (!winner) throw new Error("download link key unavailable");
	return winner;
}

/** A download link for `envelopeId`, valid for 15 minutes, relative to the site. */
export async function downloadLink(
	ctx: PluginContext,
	envelopeId: string,
	now: number,
): Promise<{ url: string; expiresAt: string }> {
	const query = await signLink({
		secret: await linkSecret(ctx.kv),
		purpose: DOWNLOAD_PURPOSE,
		params: { e: envelopeId },
		now,
		ttlMs: DOWNLOAD_TTL_MS,
	});
	const expiresAt = new Date(Number(query.get("exp")) * 1000).toISOString();
	return { url: `/_emdash/api/plugins/${ctx.plugin.id}/public/download?${query}`, expiresAt };
}

function errorResponse(code: ErrorCode) {
	const { status, body } = toRouteError(code);
	return pluginResponse({
		status,
		headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
		body: { kind: "text", value: JSON.stringify(body) },
	});
}

function queryOf(request: { url?: string } | undefined): URLSearchParams | null {
	try {
		return request?.url ? new URL(request.url).searchParams : null;
	} catch {
		return null;
	}
}

async function download(routeCtx: { request?: { url?: string } }, ctx: PluginContext) {
	const query = queryOf(routeCtx.request);
	if (!query) return errorResponse("TOKEN_INVALID");
	if (query.has("token")) return errorResponse("TOKEN_IN_QUERY");
	const now = Date.now();
	const link = await verifyLink({ secret: await linkSecret(ctx.kv), purpose: DOWNLOAD_PURPOSE, query, now });
	if (!link.ok) return errorResponse(link.error);
	const envelopeId = link.value.e;
	if (typeof envelopeId !== "string" || !ID_PATTERN.test(envelopeId)) return errorResponse("TOKEN_INVALID");

	const { envelopes, artifacts } = stores(ctx);
	const envelope = await envelopes.get(envelopeId);
	if (!envelope || envelope.status !== "completed") return errorResponse("ENVELOPE_NOT_FOUND");
	if (!envelope.pdfSha256 || !envelope.pdf) {
		await schedulePdfJob(ctx.cron, envelopeId, now);
		return errorResponse("SIGNED_PDF_PENDING");
	}
	const chunks = await artifacts.getMany(envelope.pdf.ids);
	const bytes = joinPdf([...chunks.values()]);
	if (!bytes || (await sha256Hex(bytes)) !== envelope.pdfSha256) {
		ctx.log.error("signed PDF chunks do not match pdfSha256", { envelopeId });
		return errorResponse("INTERNAL");
	}
	return pluginResponse({
		status: 200,
		headers: {
			"content-type": "application/pdf",
			"content-disposition": `attachment; filename="signed-${envelopeId.replace(/[^A-Za-z0-9_-]/g, "_")}.pdf"`,
			"cache-control": "private, no-store",
			"x-content-type-options": "nosniff",
			"referrer-policy": "no-referrer",
		},
		body: { kind: "bytes", value: bytes },
	});
}

export const downloadHandler: RouteHandler = (routeCtx, ctx) =>
	download(routeCtx as unknown as { request?: { url?: string } }, ctx);
