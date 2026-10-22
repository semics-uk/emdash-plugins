/**
 * `public/templates/catalog` (ES-FR-14, protocol §8.5, T062).
 *
 * Request `{ request: <esign-catalog/1 token> }`, verified with the shared verifier (§6.2 steps 1-7).
 * Response `{ ok, templates: [{ id, name, version }] }`: only the heads for which
 * `availableToIntegrations(head)` is true (active and flagged, T061), sorted by name. Nothing else of
 * a template (body, fields, description) leaves the site.
 *
 * Bridge calls: settings + client (2), then active heads 200 a page, at most 3 pages = 5.
 */
import { verifyCatalogToken } from "@semics-tech/shared";
import type { PluginContext, RouteHandler } from "emdash/plugin";
import { availableToIntegrations, type TemplateDoc } from "../domain/templates";
import { fail, obj, stores } from "./envelopes";
import { integrationClients } from "./integration";

const PAGE = 200;
const MAX_PAGES = 3;

export async function templateCatalog(input: unknown, ctx: PluginContext, now = Date.now()): Promise<unknown> {
	const verified = await verifyCatalogToken({
		token: obj(input).request,
		now,
		getClient: integrationClients(ctx).getClient,
	});
	if (!verified.ok) return fail(verified.error);
	const heads: Array<{ id: string; data: TemplateDoc }> = [];
	let cursor: string | undefined;
	for (let page = 0; page < MAX_PAGES; page++) {
		const result = await stores(ctx).templates.query({
			where: { status: "active" },
			limit: PAGE,
			...(cursor === undefined ? {} : { cursor }),
		});
		heads.push(...result.items);
		if (!result.hasMore || !result.cursor) break;
		cursor = result.cursor;
	}
	const templates = heads
		.filter((h) => availableToIntegrations(h.data))
		.map((h) => ({ id: h.id, name: h.data.name, version: h.data.version }))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
	return { ok: true, templates };
}

export const catalogHandler: RouteHandler = (routeCtx, ctx) => templateCatalog(routeCtx.input, ctx);
