/**
 * Automatic pairing of Events with E-sign on one site (T145), behind `/_events/pair`.
 *
 * Sandbox facts this rests on (EmDash 1.2):
 * - A sandboxed core reaches only its own settings, storage and KV (all scoped by
 *   plugin id) and cannot call another plugin's routes, so neither core can pair the other.
 * - Site pages run as native code. For a signed-in visitor `locals.emdash` carries
 *   `handlePluginApiRoute`, which runs any route of a plugin (private ones too) in process with the
 *   caller we pass; anonymous visitors only get `handlePublicPluginApiRoute`.
 * - Plugin settings are written by the host's own handler (`PUT /_emdash/api/admin/plugins/<id>/settings`),
 *   which checks `plugins:manage` on `locals.user`, validates against the manifest, encrypts secrets
 *   and merges (only the keys sent; `null` deletes). Its answers mask secrets (`secretsSet`).
 *
 * So: the host's settings read checks the visitor is an administrator; E-sign's private
 * `integrations/pair` (called as that administrator, with a fresh server-side `Request`) returns the
 * pairing string for one reusable site client; the host's settings write stores it in Events
 * (`esignPairing`, encrypted). The string lives only in this function's memory: it is never in a
 * response, URL, cookie or log. Glue only: no rules, no tokens, no `@semics-tech/shared` (R35).
 */

import { loadCatalogue } from "./templates";

/** The page (injected by `suiteIntegration`). */
export const PAIR_PATH = "/_events/pair";
const ESIGN_ROUTE = "integrations/pair";
const SETTING = "esignPairing";

export interface PairIds {
	eventsPluginId: string;
	esignPluginId: string;
}

/** The host's plugin-settings handlers, run in process with the visitor's `locals`. */
export interface SettingsHandlers {
	read(pluginId: string): Promise<Response>;
	write(pluginId: string, values: Record<string, unknown>): Promise<Response>;
}

export interface PairContext {
	locals: unknown;
	url: URL;
	settings: SettingsHandlers;
	/**
	 * Events' stored pairing string, decrypted on the server (`getPluginSetting` in the page). Only its
	 * client id is used, so the page can tell E-sign which client Events holds (T149); the secret half
	 * is dropped here and never leaves this process.
	 */
	readPairing?: () => Promise<unknown>;
}

export type PairState = "paired" | "unpaired" | "revoked" | "esign-missing" | "forbidden" | "error";
export interface PairView {
	state: PairState;
	/** T150: templates loaded into Events Pro's catalogue by this action; absent when none could be. */
	templates?: number;
	/** T150: why the templates could not be loaded (an error code; `NOT_FOUND` on Free Events). */
	templatesCode?: string;
	/** An error code (never a message that could carry a value). */
	code?: string;
	/** The page removed a pairing left behind by an uninstalled E-sign. */
	cleared?: true;
}

interface HandlerResponse {
	success?: boolean;
	data?: unknown;
	error?: { code?: unknown; message?: unknown };
}
type RouteHandler = (
	pluginId: string,
	method: string,
	path: string,
	request: Request,
	user?: unknown,
) => Promise<HandlerResponse>;

interface Admin {
	call: RouteHandler;
	user: unknown;
}

function adminOf(locals: unknown): Admin | null {
	const l = (locals ?? {}) as { user?: unknown; emdash?: { handlePluginApiRoute?: unknown } };
	const call = l.emdash?.handlePluginApiRoute;
	return typeof call === "function" && l.user ? { call: call as RouteHandler, user: l.user } : null;
}

type EsignAnswer =
	| { kind: "missing" }
	| { kind: "error"; code: string }
	| { kind: "ok"; data: Record<string, unknown> };

const PAIRING_ID = /^esign1\.([A-Za-z0-9_-]{4,64})\.[A-Za-z0-9_-]{43}$/;

/** The client id of the pairing Events holds (a hand-made one too), or undefined. Never the secret. */
async function heldClientId(ctx: PairContext): Promise<string | undefined> {
	const value = await ctx.readPairing?.().catch(() => undefined);
	return typeof value === "string" ? PAIRING_ID.exec(value)?.[1] : undefined;
}

/** E-sign's `integrations/pair`, in process. "missing" only when the host says the plugin is not there. */
async function esign(
	ctx: PairContext,
	admin: Admin,
	ids: PairIds,
	action: string,
	clientId?: string,
): Promise<EsignAnswer> {
	const request = new Request(new URL(`/_emdash/api/plugins/${ids.esignPluginId}/${ESIGN_ROUTE}`, ctx.url), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(clientId ? { action, clientId } : { action }),
	});
	const res = await admin.call(ids.esignPluginId, "POST", ESIGN_ROUTE, request, admin.user).catch(() => null);
	if (!res) return { kind: "error", code: "INTERNAL" };
	if (!res.success) {
		const message = typeof res.error?.message === "string" ? res.error.message : "";
		if (res.error?.code === "NOT_FOUND" && /^Plugin not (enabled|found)/.test(message)) return { kind: "missing" };
		return { kind: "error", code: typeof res.error?.code === "string" ? res.error.code : "INTERNAL" };
	}
	const data = (res.data ?? {}) as Record<string, unknown>;
	if (data.ok !== true) {
		const code = (data.error as { code?: unknown } | undefined)?.code;
		return { kind: "error", code: typeof code === "string" ? code : "INTERNAL" };
	}
	return { kind: "ok", data };
}

/** Whether Events holds a pairing string, or null when the visitor may not manage plugins. */
async function eventsPaired(ctx: PairContext, ids: PairIds): Promise<boolean | null> {
	const res = await ctx.settings.read(ids.eventsPluginId).catch(() => null);
	if (!res?.ok) return null;
	const body = (await res.json().catch(() => ({}))) as { data?: { secretsSet?: Record<string, unknown> } };
	return body.data?.secretsSet?.[SETTING] === true;
}

/** Writes Events' pairing setting (`null` removes it); the error code on failure. */
async function writePairing(ctx: PairContext, ids: PairIds, value: string | null): Promise<string | null> {
	const res = await ctx.settings.write(ids.eventsPluginId, { [SETTING]: value }).catch(() => null);
	if (res?.ok) return null;
	const body = (await res?.json().catch(() => ({}))) as { error?: { code?: unknown } } | undefined;
	return typeof body?.error?.code === "string" ? body.error.code : "INTERNAL";
}

/**
 * The page's state for a GET. A pairing left in Events after E-sign was removed is cleared here, so
 * Events goes back to asking for one (the "pairing" waiver state) instead of minting intents nobody
 * can redeem; that write only ever removes a pairing that cannot work.
 */
export async function pairingStatus(ctx: PairContext, ids: PairIds): Promise<PairView> {
	const admin = adminOf(ctx.locals);
	if (!admin) return { state: "forbidden" };
	const paired = await eventsPaired(ctx, ids);
	if (paired === null) return { state: "forbidden" };
	const status = await esign(ctx, admin, ids, "status", paired ? await heldClientId(ctx) : undefined);
	if (status.kind === "missing") {
		if (!paired) return { state: "esign-missing" };
		const failed = await writePairing(ctx, ids, null);
		return failed ? { state: "error", code: failed } : { state: "esign-missing", cleared: true };
	}
	if (status.kind === "error") return { state: "error", code: status.code };
	if (!paired) return { state: "unpaired" };
	return { state: status.data.client === "active" ? "paired" : "revoked" };
}

/**
 * T150: loads E-sign's templates into Events Pro's catalogue (`loadCatalogue`, in process), so the
 * panel offers them without its Refresh link. Free has no catalogue: no count, the paired state stands.
 */
async function withTemplates(ctx: PairContext, ids: PairIds, view: PairView, report: boolean): Promise<PairView> {
	const loaded = await loadCatalogue({ locals: ctx.locals as never, url: ctx.url }, ids);
	if (loaded.ok) return { ...view, templates: loaded.count };
	return report ? { ...view, templatesCode: loaded.code } : view;
}

/** The page's POST: `pair` (idempotent), `unpair`, or `templates` (fetch the catalogue again, T150). */
export async function pairAction(ctx: PairContext, ids: PairIds, action: unknown): Promise<PairView> {
	if (action !== "pair" && action !== "unpair" && action !== "templates")
		return { state: "error", code: "BAD_REQUEST" };
	const admin = adminOf(ctx.locals);
	if (!admin) return { state: "forbidden" };
	const paired = await eventsPaired(ctx, ids);
	if (paired === null) return { state: "forbidden" };
	const held = paired ? await heldClientId(ctx) : undefined;

	if (action === "templates") {
		return paired ? withTemplates(ctx, ids, { state: "paired" }, true) : { state: "unpaired" };
	}
	if (action === "unpair") {
		const revoked = await esign(ctx, admin, ids, "unpair", held);
		if (revoked.kind === "error") return { state: "error", code: revoked.code };
		const failed = await writePairing(ctx, ids, null);
		return failed ? { state: "error", code: failed } : { state: "unpaired" };
	}

	const made = await esign(ctx, admin, ids, "pair", held);
	if (made.kind === "missing") return { state: "esign-missing" };
	if (made.kind === "error") return { state: "error", code: made.code };
	const pairing = made.data.pairing;
	if (typeof pairing !== "string" || !pairing.startsWith("esign1.")) return { state: "error", code: "INTERNAL" };
	const failed = await writePairing(ctx, ids, pairing);
	return failed ? { state: "error", code: failed } : withTemplates(ctx, ids, { state: "paired" }, false);
}
