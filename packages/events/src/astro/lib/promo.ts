/**
 * Promo codes in the booking widget (EV-FR-14, T078). The codes are Events Pro's: reserve takes
 * `promoCode`, and `public/promo/check` says whether a code works for an event and, for an unlock
 * code, which hidden ticket types it reveals. This module is the Free UI's side, and touches the core
 * only through those public routes:
 *
 * - `POST /_events/promo` (the widget's "Apply" button, a plain form post that works without
 *   JavaScript): refuses cross-site posts, asks `public/promo/check`, keeps an accepted code in an
 *   HttpOnly cookie for this event and goes back to the widget. The code never goes into a URL (an
 *   unlock code is a credential for hidden tickets): refusals go back as an error code only.
 * - `promoView`: what the widget shows for the cookie's code (the hidden types and a note), asked
 *   afresh on every render so a code that stopped working stops showing.
 *
 * The widget shows the field only when `public/event` says the core takes codes (`promoCodes`, set by
 * Pro), so a Free site never offers one; and checkout sends `promoCode` only when a code was typed.
 */
import { callPublicRoute, type PublicRouteContext } from "./call";
import { type CheckoutEndpointContext, crossSiteResponse, isCrossSiteRequest } from "./checkout-form";
import { anchorId, formatMoney, safeReturnTo, widgetErrorLocation } from "./widget";

export const PROMO_PATH = "/_events/promo";
/** How long an applied code is remembered for the event (it is checked again on every render). */
export const PROMO_COOKIE_SECONDS = 30 * 60;
const MAX_CODE = 60;

export interface PromoHiddenType {
	id: string;
	name: string;
	priceMinor: number;
}

/** What `public/promo/check` answers for a code that works. */
export interface PromoCheck {
	kind: "percent" | "fixed" | "unlock";
	/** Basis points (`percent`) or minor units (`fixed`). */
	value?: number;
	currency?: string;
	hiddenTypes: PromoHiddenType[];
}

export interface PromoView {
	code: string;
	note: string;
	hiddenTypes: PromoHiddenType[];
}

export const promoCookieName = (eventId: string) => `semics_promo_${eventId.replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** The applied-code cookie: HttpOnly, the whole site (the widget can be on any page), 30 minutes. */
export function promoCookieOptions(url: URL) {
	return {
		path: "/",
		httpOnly: true,
		sameSite: "lax" as const,
		secure: url.protocol === "https:",
		maxAge: PROMO_COOKIE_SECONDS,
	};
}

/** A typed code, trimmed; "" when there is none or it is too long to be one. */
export function promoCodeOf(raw: unknown): string {
	const code = typeof raw === "string" ? raw.trim() : "";
	return code.length <= MAX_CODE ? code : "";
}

/** The refusal codes the widget has messages for; anything else (Free has no such route) is PROMO_INVALID. */
const KEPT = new Set(["PROMO_EXHAUSTED", "RATE_LIMITED"]);

async function checkCode(
	ctx: PublicRouteContext,
	input: { eventId: string; code: string },
	pluginId: string | undefined,
): Promise<{ ok: true; check: PromoCheck } | { ok: false; code: string }> {
	const result = await callPublicRoute<PromoCheck>(ctx, {
		method: "POST",
		path: "public/promo/check",
		pluginId,
		body: { eventId: input.eventId, code: input.code },
	});
	if (!result.ok) return { ok: false, code: KEPT.has(result.error.code) ? result.error.code : "PROMO_INVALID" };
	const hiddenTypes = Array.isArray(result.data.hiddenTypes) ? result.data.hiddenTypes : [];
	return { ok: true, check: { ...result.data, hiddenTypes } };
}

/** The line the widget shows under an applied code. */
export function promoNote(check: PromoCheck, currency: string, locale = "en-GB"): string {
	const value = typeof check.value === "number" ? check.value : 0;
	if (check.kind === "percent" && value > 0) return `Code applied: ${value / 100}% off your order.`;
	if (check.kind === "fixed" && value > 0) {
		return `Code applied: ${formatMoney(value, check.currency ?? currency, locale)} off your order.`;
	}
	return check.hiddenTypes.length > 0 ? "Code applied: more tickets are now available." : "Code applied.";
}

/** The widget's view of the code in the cookie, or `null` (no code, Free, or it no longer works). */
export async function promoView(
	ctx: PublicRouteContext,
	input: { eventId: string; code: string; currency?: string; locale?: string },
	options: { pluginId?: string },
): Promise<PromoView | null> {
	const code = promoCodeOf(input.code);
	if (!code) return null;
	const checked = await checkCode(ctx, { eventId: input.eventId, code }, options.pluginId);
	if (!checked.ok) return null;
	return {
		code,
		note: promoNote(checked.check, input.currency ?? "GBP", input.locale),
		hiddenTypes: checked.check.hiddenTypes,
	};
}

export interface PromoEndpointContext extends Omit<CheckoutEndpointContext, "cookies"> {
	cookies: {
		set(name: string, value: string, options: Record<string, unknown>): void;
		delete(name: string, options: Record<string, unknown>): void;
	};
}

const text = (form: FormData, key: string) => {
	const value = form.get(key);
	return typeof value === "string" ? value.trim() : "";
};

/** `POST /_events/promo`: refuse cross-site posts, check the code, remember or forget it, back to the widget (303). */
export async function handlePromoRequest(
	{ request, url, locals, redirect, cookies }: PromoEndpointContext,
	options: { pluginId?: string },
): Promise<Response> {
	if (isCrossSiteRequest(request, url)) return crossSiteResponse();
	const form = await request.formData().catch(() => new FormData());
	const eventId = text(form, "eventId");
	const returnTo = safeReturnTo(text(form, "returnTo"), url.origin) ?? "/";
	const back = `${returnTo}#${anchorId(eventId)}`;
	if (!eventId || eventId.length > 200) return redirect(returnTo, 303);
	const cookie = promoCookieName(eventId);
	const forget = () => cookies.delete(cookie, { path: "/" });
	const raw = text(form, "promoCode");
	if (!raw) {
		forget();
		return redirect(back, 303);
	}
	const code = promoCodeOf(raw);
	const checked = code
		? await checkCode({ locals, url, request }, { eventId, code }, options.pluginId)
		: { ok: false as const, code: "PROMO_INVALID" };
	if (!checked.ok) {
		forget();
		return redirect(widgetErrorLocation(returnTo, eventId, checked.code, ["promo"]), 303);
	}
	cookies.set(cookie, code, promoCookieOptions(url));
	return redirect(back, 303);
}
