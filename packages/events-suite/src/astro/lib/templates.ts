/**
 * The catalogue refresh behind the Events panel's "Refresh templates" (SX-FR-07; esign-intent/1 §8.5).
 * The Events core cannot reach E-sign, and only it holds the pairing secret, so the panel's button
 * (Events Pro) mints a short-lived catalogue request and links to `/_events/templates#catalog=<request>`
 * (a fragment: tokens never travel in URLs). The page posts the request here: E-sign's
 * `public/templates/catalog` answers with the templates flagged "available to integrations", and
 * Events `esign/catalog` caches them for the panel's template select. Events checks the request
 * again (it must be one it minted, within five minutes), so a forged list cannot get in.
 *
 * Glue only. Web APIs only, no `@semics-tech/shared` (R35).
 */
import { callPublicRoute, type PublicRouteContext } from "@semics-tech/emdash-events/astro/lib/call";

/** The page the panel links to (injected by `suiteIntegration`). */
export const TEMPLATES_PATH = "/_events/templates";

export interface CatalogueIds {
	eventsPluginId: string;
	esignPluginId: string;
}

export type CatalogueResult = { ok: true; count: number } | { ok: false; code: string };

const REQUEST = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;
const REQUEST_MAX = 1024;
const TEMPLATE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TEMPLATES = 100;

interface Template {
	id: string;
	name: string;
	version: number;
}

/** The templates that fit the protocol's grammar; anything else e-sign sent is dropped. */
function usable(raw: unknown): Template[] {
	if (!Array.isArray(raw)) return [];
	const out: Template[] = [];
	for (const t of raw) {
		const { id, name, version } = (t ?? {}) as Record<string, unknown>;
		if (typeof id !== "string" || !TEMPLATE_ID.test(id)) continue;
		if (typeof name !== "string" || name.length < 1 || name.length > 200) continue;
		if (typeof version !== "number" || !Number.isInteger(version) || version < 1) continue;
		out.push({ id, name, version });
		if (out.length === MAX_TEMPLATES) break;
	}
	return out;
}

/** Fetches the catalogue with `request` and hands it to Events. Never throws. */
export async function refreshCatalogue(
	ctx: PublicRouteContext,
	request: unknown,
	ids: CatalogueIds,
): Promise<CatalogueResult> {
	if (typeof request !== "string" || request.length > REQUEST_MAX || !REQUEST.test(request)) {
		return { ok: false, code: "REQUEST_INVALID" };
	}
	const fetched = await callPublicRoute<{ templates?: unknown }>(ctx, {
		method: "POST",
		path: "public/templates/catalog",
		pluginId: ids.esignPluginId,
		body: { request },
	}).catch(() => null);
	if (!fetched) return { ok: false, code: "INTERNAL" };
	if (!fetched.ok) return { ok: false, code: fetched.error.code };
	const templates = usable(fetched.data.templates);
	const cached = await callPublicRoute(ctx, {
		method: "POST",
		path: "esign/catalog",
		pluginId: ids.eventsPluginId,
		body: { request, templates },
	}).catch(() => null);
	if (!cached) return { ok: false, code: "INTERNAL" };
	return cached.ok ? { ok: true, count: templates.length } : { ok: false, code: cached.error.code };
}
