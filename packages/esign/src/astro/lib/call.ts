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
	const request = buildRequest(ctx.url.origin, pluginId, method, path, call.body);

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

function buildRequest(origin: string, pluginId: string, method: string, path: string, body: unknown): Request {
	const url = new URL(`/_emdash/api/plugins/${encodeURIComponent(pluginId)}/${path}`, origin);
	if (method === "GET") {
		if (body && typeof body === "object") {
			for (const [key, value] of Object.entries(body)) {
				for (const item of Array.isArray(value) ? value : [value]) {
					if (item !== undefined && item !== null) url.searchParams.append(key, String(item));
				}
			}
		}
		return new Request(url, { method });
	}
	return new Request(url, {
		method,
		headers: { "content-type": "application/json" },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
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
