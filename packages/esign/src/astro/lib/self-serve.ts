import { type MessageKey, t } from "../../i18n/index.ts";
import { callPublicRoute, type PublicRouteContext } from "./call.ts";
import { crossSiteResponse, isCrossSiteRequest } from "./csrf.ts";

/**
 * The `esign-request` block's logic (ES-FR-18, SU-FR-12), kept out of the `.astro` file so it is testable.
 * It only calls `public/self-serve/start`, which is a NOT_FOUND stub on Free: there the block renders its
 * unavailable state and no form. The signing link goes to the visitor's inbox and is never in a response.
 */

export const START_PATH = "/_esign/start";
const ROUTE = "public/self-serve/start";
const STATE_PARAM = "esign_start";
const TEMPLATE_PARAM = "esign_t";
const FIELD_PREFIX = "field:";

export interface SelfServeTemplate {
	id: string;
	name: string;
	description?: string;
	/** Placeholders the visitor fills in (name and email are always asked). */
	fields: string[];
}

export type SelfServeView =
	| { state: "ready"; template: SelfServeTemplate; turnstileSiteKey?: string }
	| { state: "unavailable" };

/** Describes the block's template through the core; any refusal (Free's stub, no licence, not offered) is `unavailable`. */
export async function loadSelfServe(
	ctx: PublicRouteContext,
	options: { templateId: string; pluginId?: string },
): Promise<SelfServeView> {
	const templateId = options.templateId.trim();
	if (!templateId) return { state: "unavailable" };
	const res = await callPublicRoute<{ template?: SelfServeTemplate; turnstileSiteKey?: string }>(ctx, {
		method: "POST",
		path: ROUTE,
		body: { templateId, describe: true },
		...(options.pluginId ? { pluginId: options.pluginId } : {}),
	});
	if (!res.ok || !res.data.template) return { state: "unavailable" };
	const { template, turnstileSiteKey } = res.data;
	return { state: "ready", template, ...(turnstileSiteKey ? { turnstileSiteKey } : {}) };
}

const text = (form: FormData, key: string): string => {
	const v = form.get(key);
	return typeof v === "string" ? v.trim() : "";
};

/** A same-site path, so a post can never redirect elsewhere. */
function safeReturnTo(raw: string, origin: string): string | undefined {
	if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return undefined;
	try {
		const url = new URL(raw, origin);
		if (url.origin !== origin || url.pathname.startsWith("//") || url.pathname.startsWith("/_esign/")) return undefined;
		url.searchParams.delete(STATE_PARAM);
		url.searchParams.delete(TEMPLATE_PARAM);
		return `${url.pathname}${url.search}`;
	} catch {
		return undefined;
	}
}

export const anchorOf = (templateId: string) => `esign-request-${templateId}`;

function backTo(returnTo: string, templateId: string, state: string): string {
	const url = new URL(returnTo, "https://x.invalid");
	url.searchParams.set(STATE_PARAM, state);
	url.searchParams.set(TEMPLATE_PARAM, templateId);
	return `${url.pathname}${url.search}#${anchorOf(templateId)}`;
}

export type StartResult = { location: string } | { status: number; message: string };

/** Posts the visitor's details to the core and says where to go next. Values are never put in the location. */
export async function handleSelfServeForm(
	ctx: PublicRouteContext,
	form: FormData,
	options: { pluginId?: string },
): Promise<StartResult> {
	const templateId = text(form, "templateId");
	// i18n-ignore: a malformed post (not the block's form) gets a plain refusal.
	if (!templateId) return { status: 400, message: "Missing template." };
	const returnTo = safeReturnTo(text(form, "returnTo"), ctx.url.origin) ?? "/";
	const fields: Record<string, string> = {};
	for (const [key, value] of form.entries()) {
		if (key.startsWith(FIELD_PREFIX) && typeof value === "string") fields[key.slice(FIELD_PREFIX.length)] = value;
	}
	const res = await callPublicRoute(ctx, {
		method: "POST",
		path: ROUTE,
		...(options.pluginId ? { pluginId: options.pluginId } : {}),
		body: {
			templateId,
			name: text(form, "name"),
			email: text(form, "email"),
			fields,
			turnstileToken: text(form, "cf-turnstile-response"),
			website: text(form, "website"),
		},
	});
	return { location: backTo(returnTo, templateId, res.ok ? "sent" : res.error.code) };
}

/** What `POST /_esign/start` gets from Astro. */
export interface StartEndpointContext {
	request: Request;
	url: URL;
	locals: PublicRouteContext["locals"];
	redirect(location: string, status?: number): Response;
}

/** `POST /_esign/start`: refuse cross-site posts first, then run the form and redirect (303). */
export async function handleStartRequest(
	{ request, url, locals, redirect }: StartEndpointContext,
	options: { pluginId?: string },
): Promise<Response> {
	if (isCrossSiteRequest(request, url)) return crossSiteResponse();
	const form = await request.formData().catch(() => new FormData());
	const result = await handleSelfServeForm({ locals, url, request }, form, options);
	if ("location" in result) return redirect(result.location, 303);
	return new Response(result.message, {
		status: result.status,
		headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
	});
}

/** The state the block reads back from its page URL, for its own template only. */
export function readStartState(url: URL, templateId: string): { sent: boolean; code?: string } {
	if (url.searchParams.get(TEMPLATE_PARAM) !== templateId) return { sent: false };
	const state = url.searchParams.get(STATE_PARAM);
	if (state === "sent") return { sent: true };
	return state ? { sent: false, code: state } : { sent: false };
}

const CODES = [
	"TURNSTILE_FAILED",
	"RATE_LIMITED",
	"SELF_SERVE_FULL",
	"BAD_REQUEST",
	"TEMPLATE_NOT_FOUND",
	"SITE_URL_MISSING",
];

/** What the block says about a refused start, in the locale's language (T102). */
export const startMessage = (code: string, locale?: string): string =>
	t(locale, `selfServe.error.${CODES.includes(code) ? code : "INTERNAL"}` as MessageKey);
