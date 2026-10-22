// i18n-ignore-file: these errors are for developers (the UI shows its own text by error code, T102).
import { getPublicPluginApiRouteHandler, type PublicPluginRuntimeLocals } from "emdash/plugin-utils";

/** Plugin ID (manifest slug) of the sandboxed E-sign core. */
export const ESIGN_PLUGIN_ID = "semics-esign";

export type PublicRouteMethod = "GET" | "POST";

export interface PublicRouteCall {
	/** Route name as declared in the core, e.g. `public/events`. A leading slash is ignored. */
	path: string;
	/** Defaults to GET. */
	method?: PublicRouteMethod;
	/** JSON body for POST; query parameters for GET. */
	body?: unknown;
	/** Defaults to the context's plugin id, then the E-sign core. */
	pluginId?: string;
}

/** The parts of the Astro global the helper needs; pass `Astro` itself. */
export interface PublicRouteContext {
	locals: PublicPluginRuntimeLocals | null | undefined;
	url: URL;
	/**
	 * The visitor's request (`Astro.request`). Its user agent, client-IP headers and `cf` object are
	 * carried onto the in-process call, so the core's `requestMeta` (audit IP and user agent, per-IP
	 * rate limits) sees the visitor as a direct call would. Cookies, credentials and the Referer never are.
	 */
	request?: Request;
	/** The core's plugin id when it is not the default slug (the integration's `pluginId`). */
	pluginId?: string;
	/** Injected for tests. Defaults to the global `fetch`. */
	fetch?: typeof fetch;
}

export interface PublicRouteIssue {
	path: string;
	code: string;
}

export interface PublicRouteError {
	code: string;
	message: string;
	/** Input validation issues, when the route reported them (`BAD_REQUEST`). */
	issues?: PublicRouteIssue[];
}

export type PublicRouteResult<T> =
	| { ok: true; data: T; via: "in-process" | "fetch" }
	| { ok: false; error: PublicRouteError; via: "in-process" | "fetch" };

interface Envelope {
	success?: boolean;
	data?: unknown;
	error?: { code?: unknown; message?: unknown };
}

/**
 * The only way UI code calls the core. Dispatches in-process through
 * `getPublicPluginApiRouteHandler(Astro.locals)` (Spike S2: reaches sandboxed public routes on the
 * workerd runner), and falls back to `fetch(Astro.url.origin + route)` when the in-process handler
 * isn't on `locals`. Never throws: every failure comes back as `{ ok: false, error }` so components
 * can render a defined error state.
 */
export async function callPublicRoute<T = unknown>(
	ctx: PublicRouteContext,
	call: PublicRouteCall,
): Promise<PublicRouteResult<T>> {
	const method = call.method ?? "GET";
	const path = call.path.replace(/^\/+/, "");
	const pluginId = call.pluginId ?? ctx.pluginId ?? ESIGN_PLUGIN_ID;
	const handler = getPublicPluginApiRouteHandler(ctx.locals);
	const via = handler ? "in-process" : "fetch";

	const unsafeKey = method === "GET" ? tokenLikeKey(call.body) : undefined;
	if (unsafeKey !== undefined) {
		return {
			ok: false,
			error: {
				code: "TOKEN_IN_QUERY",
				message: `"${unsafeKey}" looks like a token; send it with POST, never in a URL`,
			},
			via,
		};
	}
	const request = buildRequest(ctx.url.origin, pluginId, method, path, call.body, ctx.request);

	if (handler) {
		try {
			return toResult<T>(await handler(pluginId, method, path, request), "in-process");
		} catch (error) {
			return failure(error, "in-process");
		}
	}

	try {
		const response = await (ctx.fetch ?? fetch)(request);
		const envelope = (await response.json().catch(() => ({}))) as Envelope;
		if (!response.ok && envelope.success !== false) {
			return {
				ok: false,
				error: { code: `HTTP_${response.status}`, message: response.statusText || "Request failed" },
				via: "fetch",
			};
		}
		return toResult<T>(envelope, "fetch");
	} catch (error) {
		return failure(error, "fetch");
	}
}

/** Tokens must never travel in URLs (BUILD-PLAN R10), so GET bodies may not carry token-like keys. */
const TOKEN_LIKE = /^(t|.*token.*|.*receipt.*|.*secret.*|.*otp.*)$/i;

function tokenLikeKey(body: unknown): string | undefined {
	if (!body || typeof body !== "object") return undefined;
	return Object.keys(body).find((key) => TOKEN_LIKE.test(key));
}

/**
 * Headers never copied from the visitor's request: credentials (a public route has no use for them),
 * the Referer (the sign page's own URL holds the token), and the framing of the page's own body.
 */
const NOT_FORWARDED = new Set([
	"authorization",
	"connection",
	"content-length",
	"content-type",
	"cookie",
	"expect",
	"host",
	"keep-alive",
	"proxy-authorization",
	"referer",
	"transfer-encoding",
	"upgrade",
	"x-emdash-request",
]);

function forwardedHeaders(incoming: Request | undefined): Headers {
	const headers = new Headers();
	incoming?.headers.forEach((value, key) => {
		if (!NOT_FORWARDED.has(key.toLowerCase())) headers.set(key, value);
	});
	return headers;
}

/** On Cloudflare the host trusts `cf-connecting-ip` only on a request that carries a `cf` object. */
function withCf(request: Request, incoming: Request | undefined): Request {
	const cf = (incoming as { cf?: unknown } | undefined)?.cf;
	if (cf !== undefined && cf !== null) Object.defineProperty(request, "cf", { value: cf, enumerable: true });
	return request;
}

function buildRequest(
	origin: string,
	pluginId: string,
	method: string,
	path: string,
	body: unknown,
	incoming?: Request,
): Request {
	const headers = forwardedHeaders(incoming);
	const url = new URL(`/_emdash/api/plugins/${encodeURIComponent(pluginId)}/${path}`, origin);
	if (method === "GET") {
		if (body && typeof body === "object") {
			for (const [key, value] of Object.entries(body)) {
				for (const item of Array.isArray(value) ? value : [value]) {
					if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
				}
			}
		}
		return withCf(new Request(url, { method, headers }), incoming);
	}
	headers.set("content-type", "application/json");
	const json = body === undefined ? undefined : JSON.stringify(body);
	return withCf(new Request(url, { method, headers, body: json }), incoming);
}

/** A sandboxed route's own refusal (`{ ok: false, error, issues? }`), which the host wraps as a success. */
function refusal(data: unknown): PublicRouteError | undefined {
	if (!data || typeof data !== "object") return undefined;
	const body = data as { ok?: unknown; error?: { code?: unknown; message?: unknown }; issues?: unknown };
	if (body.ok !== false || typeof body.error?.code !== "string") return undefined;
	return {
		code: body.error.code,
		message: typeof body.error.message === "string" ? body.error.message : "Request failed",
		...(Array.isArray(body.issues) ? { issues: body.issues as PublicRouteIssue[] } : {}),
	};
}

function toResult<T>(envelope: Envelope, via: "in-process" | "fetch"): PublicRouteResult<T> {
	if (envelope.success === true) {
		const refused = refusal(envelope.data);
		return refused ? { ok: false, error: refused, via } : { ok: true, data: envelope.data as T, via };
	}
	const code = typeof envelope.error?.code === "string" ? envelope.error.code : "ROUTE_CALL_FAILED";
	const message = typeof envelope.error?.message === "string" ? envelope.error.message : "Request failed";
	return { ok: false, error: { code, message }, via };
}

function failure<T>(error: unknown, via: "in-process" | "fetch"): PublicRouteResult<T> {
	const message = error instanceof Error ? error.message : "Request failed";
	return { ok: false, error: { code: "ROUTE_CALL_FAILED", message }, via };
}
