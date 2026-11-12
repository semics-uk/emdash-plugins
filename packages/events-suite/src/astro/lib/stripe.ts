/**
 * `POST /_semics/stripe`, the site's one Stripe webhook endpoint (T163 §4a, T166). Stripe allows one endpoint
 * and one signing secret per site, while Events Pro and Vouchers each take their own Checkout payments. This
 * endpoint verifies nothing itself: it reads `data.object.metadata.plugin` from the raw body and hands the raw
 * body and the `stripe-signature` header, in process, to that plugin's `webhooks/stripe`. `vouchers` goes to
 * Vouchers when the site has it; anything else, including old sessions with no tag, goes to Events. Each plugin
 * verifies the signature with the same webhook secret, so a forged tag reaches only a plugin that rejects it.
 * Events' own `webhooks/stripe` endpoint keeps working for sites that point Stripe straight at it.
 *
 * Stripe is not a browser: no cookies, no Origin check. Web APIs only, no `@semics-tech/shared` (R35).
 */
import { getPublicPluginApiRouteHandler, type PublicPluginRuntimeLocals } from "emdash/plugin-utils";

export interface StripeRouteIds {
	eventsPluginId: string;
	/** Absent when the site has no Vouchers core: every delivery goes to Events. */
	vouchersPluginId?: string;
}

export interface StripeEndpointContext {
	locals: PublicPluginRuntimeLocals | null | undefined;
	url: URL;
	request: Request;
}

const ROUTE = "webhooks/stripe";
/** Stripe's events are a few KB; refuse anything absurd before reading it all. */
const MAX_BODY = 512 * 1024;

/** The plugin a delivery is for: its session's `metadata.plugin`, defaulting to Events. */
export function targetOf(raw: string, ids: StripeRouteIds): string {
	try {
		const tag = (JSON.parse(raw) as { data?: { object?: { metadata?: { plugin?: unknown } } } })?.data?.object?.metadata
			?.plugin;
		if (tag === "vouchers" && ids.vouchersPluginId) return ids.vouchersPluginId;
	} catch {
		// Not JSON: Events answers it (with its own refusal).
	}
	return ids.eventsPluginId;
}

interface RawWire {
	status?: unknown;
	headers?: unknown;
	body?: unknown;
}

/** A sandboxed raw route's answer (`{ status, headers, body: { kind: "text", value } }`) as a Response. */
function responseOf(data: unknown): Response {
	const wire = (data ?? {}) as RawWire;
	const status = typeof wire.status === "number" && wire.status >= 200 && wire.status <= 599 ? wire.status : 200;
	const body = wire.body as { value?: unknown } | string | null | undefined;
	const text = typeof body === "string" ? body : typeof body?.value === "string" ? body.value : "";
	const headers = new Headers({ "cache-control": "no-store" });
	const type = (wire.headers as Record<string, unknown> | undefined)?.["content-type"];
	headers.set("content-type", typeof type === "string" ? type : "application/json; charset=utf-8");
	return new Response(text || null, { status, headers });
}

export async function routeStripeWebhook(ctx: StripeEndpointContext, ids: StripeRouteIds): Promise<Response> {
	const length = Number(ctx.request.headers.get("content-length") ?? 0);
	if (length > MAX_BODY) return new Response(null, { status: 413 });
	const raw = await ctx.request.text();
	if (raw.length > MAX_BODY) return new Response(null, { status: 413 });
	const pluginId = targetOf(raw, ids);
	const headers = new Headers({ "content-type": ctx.request.headers.get("content-type") ?? "application/json" });
	const signature = ctx.request.headers.get("stripe-signature");
	if (signature) headers.set("stripe-signature", signature);
	const forward = new Request(
		new URL(`/_emdash/api/plugins/${encodeURIComponent(pluginId)}/${ROUTE}`, ctx.url.origin),
		{
			method: "POST",
			headers,
			body: raw,
		},
	);
	const handler = getPublicPluginApiRouteHandler(ctx.locals);
	if (!handler) return fetch(forward);
	try {
		const result = (await handler(pluginId, "POST", ROUTE, forward)) as {
			success?: boolean;
			data?: unknown;
			status?: number;
		};
		// Not handled (plugin missing, a crash): a 5xx, so Stripe keeps the delivery and retries it.
		if (!result?.success)
			return new Response(null, { status: result?.status && result.status >= 500 ? result.status : 503 });
		return responseOf(result.data);
	} catch {
		return new Response(null, { status: 500 });
	}
}
