import { getPublicPluginApiRouteHandler, type PublicPluginRuntimeLocals } from "emdash/plugin-utils";

/** Plugin ID (manifest slug) of the sandboxed Events core. */
export const EVENTS_PLUGIN_ID = "semics-events";

export type PublicRouteMethod = "GET" | "POST";

export interface PublicRouteCall {
	/** Route name as declared in the core, e.g. `public/events`. A leading slash is ignored. */
	path: string;
	/** Defaults to GET. */
	method?: PublicRouteMethod;
	/** JSON body for POST; query parameters for GET. */
	body?: unknown;
	/** Defaults to the Events core. */
	pluginId?: string;
}

/** The parts of the Astro global the helper needs; pass `Astro` itself. */
export interface PublicRouteContext {
	locals: PublicPluginRuntimeLocals | null | undefined;
	url: URL;
	/** Injected for tests. Defaults to the global `fetch`. */
	fetch?: typeof fetch;
}

export interface PublicRouteError {
	code: string;
	message: string;
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
	const pluginId = call.pluginId ?? EVENTS_PLUGIN_ID;
	const request = buildRequest(ctx.url.origin, pluginId, method, path, call.body);

	const handler = getPublicPluginApiRouteHandler(ctx.locals);
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

function toResult<T>(envelope: Envelope, via: "in-process" | "fetch"): PublicRouteResult<T> {
	if (envelope.success === true) return { ok: true, data: envelope.data as T, via };
	const code = typeof envelope.error?.code === "string" ? envelope.error.code : "ROUTE_CALL_FAILED";
	const message = typeof envelope.error?.message === "string" ? envelope.error.message : "Request failed";
	return { ok: false, error: { code, message }, via };
}

function failure<T>(error: unknown, via: "in-process" | "fetch"): PublicRouteResult<T> {
	const message = error instanceof Error ? error.message : "Request failed";
	return { ok: false, error: { code: "ROUTE_CALL_FAILED", message }, via };
}
