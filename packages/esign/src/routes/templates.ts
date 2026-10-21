import { toRouteError } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import {
	archiveTemplate,
	createTemplate,
	type TemplateDoc,
	type TemplateIssue,
	updateTemplate,
	versionDocId,
} from "../domain/templates";

/**
 * Private (admin) template routes (ES-FR-01): `templates/create`, `update`, `get`, `list`,
 * `archive`. Thin adapters over the pure domain module; at most 2 bridge calls per invocation.
 * They have no `public` flag, so the platform rejects unauthenticated callers before the handler.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (routeCtx: { input?: unknown }, ctx: PluginContext) => Promise<unknown>;

interface TemplateStore {
	get(id: string): Promise<TemplateDoc | null>;
	getMany(ids: string[]): Promise<Map<string, TemplateDoc>>;
	putMany(items: Array<{ id: string; data: TemplateDoc }>): Promise<void>;
	query(o: {
		where: Record<string, unknown>;
		limit: number;
	}): Promise<{ items: Array<{ id: string; data: TemplateDoc }> }>;
}

const store = (ctx: PluginContext) => (ctx.storage as unknown as { templates: TemplateStore }).templates;

const badRequest = (issues?: readonly TemplateIssue[]) => ({
	...toRouteError("BAD_REQUEST").body,
	...(issues ? { issues } : {}),
});
const notFound = () => toRouteError("TEMPLATE_NOT_FOUND").body;

const obj = (input: unknown): Record<string, unknown> =>
	typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};

function idOf(input: unknown): string | null {
	const id = obj(input).id;
	return typeof id === "string" && id.length > 0 && id.length <= 200 && !id.includes(":") ? id : null;
}

const view = (id: string, doc: TemplateDoc) => ({ id, ...doc });
const summary = (id: string, { body: _body, ...rest }: TemplateDoc) => ({ id, ...rest });

/** A stored head document, or null when missing or when the id points at a version document. */
async function loadHead(ctx: PluginContext, id: string): Promise<TemplateDoc | null> {
	const doc = await store(ctx).get(id);
	return doc && doc.status !== "version" ? doc : null;
}

const LIST_LIMIT = 200;

export const TEMPLATE_ROUTES: Record<string, RouteDef> = {
	"templates/create": {
		handler: (async (routeCtx, ctx) => {
			const id = crypto.randomUUID();
			const result = createTemplate(routeCtx.input, { id, now: new Date().toISOString() });
			if (!result.ok) return badRequest(result.error);
			const { head, versions } = result.value;
			await store(ctx).putMany([{ id, data: head }, ...versions]);
			return { ok: true, template: view(id, head) };
		}) as Handler,
	},
	"templates/update": {
		handler: (async (routeCtx, ctx) => {
			const id = idOf(routeCtx.input);
			if (!id) return badRequest();
			const existing = await loadHead(ctx, id);
			if (!existing) return notFound();
			const result = updateTemplate(existing, routeCtx.input, { id, now: new Date().toISOString() });
			if (!result.ok) return badRequest(result.error);
			await store(ctx).putMany([{ id, data: result.value.head }, result.value.version]);
			return { ok: true, template: view(id, result.value.head) };
		}) as Handler,
	},
	"templates/get": {
		handler: (async (routeCtx, ctx) => {
			const id = idOf(routeCtx.input);
			if (!id) return badRequest();
			const requested = obj(routeCtx.input).version;
			if (requested !== undefined && !(Number.isSafeInteger(requested) && (requested as number) >= 1)) {
				return badRequest();
			}
			const version = requested as number | undefined;
			const docs = await store(ctx).getMany(version === undefined ? [id] : [id, versionDocId(id, version)]);
			const head = docs.get(id);
			if (!head || head.status === "version") return notFound();
			const chosen = version === undefined ? head : docs.get(versionDocId(id, version));
			if (!chosen) return notFound();
			const versions = Array.from({ length: head.version }, (_, i) => i + 1);
			return { ok: true, template: view(id, { ...chosen, status: head.status }), versions };
		}) as Handler,
	},
	"templates/list": {
		handler: (async (routeCtx, ctx) => {
			const status = obj(routeCtx.input).status ?? "active";
			if (status !== "active" && status !== "archived") return badRequest();
			const { items } = await store(ctx).query({ where: { status }, limit: LIST_LIMIT });
			const templates = items
				.map((i) => summary(i.id, i.data))
				.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
			return { ok: true, templates };
		}) as Handler,
	},
	"templates/archive": {
		handler: (async (routeCtx, ctx) => {
			const id = idOf(routeCtx.input);
			if (!id) return badRequest();
			const existing = await loadHead(ctx, id);
			if (!existing) return notFound();
			if (existing.status === "archived") return { ok: true, template: view(id, existing) };
			const archived = archiveTemplate(existing, new Date().toISOString());
			await store(ctx).putMany([{ id, data: archived }]);
			return { ok: true, template: view(id, archived) };
		}) as Handler,
	},
};
