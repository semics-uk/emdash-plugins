/**
 * The waitlist in the booking widget (EV-FR-16, EV-US-6, T081). A sold-out event whose core says it
 * takes a waitlist (`public/event` answers `waitlist: true`) shows a "Join the waitlist" form that posts
 * to the injected `POST /_events/waitlist` (no JavaScript needed). It refuses cross-site posts, asks
 * `public/waitlist/join` and goes back to the widget with an outcome code only, never what was typed.
 * Offers arrive by email; the booking page claims them (`claimOfferLink` in `./checkout-form`).
 */
import { callPublicRoute } from "./call";
import { type CheckoutEndpointContext, crossSiteResponse, isCrossSiteRequest } from "./checkout-form";
import { anchorId, safeReturnTo, WIDGET_PARAMS } from "./widget";

export const WAITLIST_PATH = "/_events/waitlist";
const PARAM = "waitlist";

/** What the widget says after a join; anything else reads as `INTERNAL`. */
export const WAITLIST_MESSAGES: Record<string, string> = {
	joined: "You are on the waitlist. If tickets come free we will email you, and hold them for you for 24 hours.",
	BAD_REQUEST: "Please check your name, email, date and number of tickets.",
	RATE_LIMITED: "Too many requests from this connection. Please wait a few minutes and try again.",
	TURNSTILE_FAILED: "The security check did not pass. Please try again.",
	NOT_FOUND: "This event is not taking a waitlist.",
	INTERNAL: "Something went wrong. Please try again.",
};

/** The outcome a widget shows after a no-JS round trip; only for the widget of `eventId`. */
export function readWaitlistState(url: URL, eventId: string): string | undefined {
	const raw = url.searchParams.get(PARAM);
	if (!raw || url.searchParams.get(WIDGET_PARAMS.event) !== eventId) return undefined;
	return Object.hasOwn(WAITLIST_MESSAGES, raw) ? raw : "INTERNAL";
}

const text = (form: FormData, key: string) => {
	const value = form.get(key);
	return typeof value === "string" ? value.trim() : "";
};

/** `POST /_events/waitlist`: refuse cross-site posts, join, back to the widget (303). */
export async function handleWaitlistRequest(
	{ request, url, locals, redirect }: CheckoutEndpointContext,
	options: { pluginId?: string },
): Promise<Response> {
	if (isCrossSiteRequest(request, url)) return crossSiteResponse();
	const form = await request.formData().catch(() => new FormData());
	const eventId = text(form, "eventId");
	// Rebuilt from its path, so the Location never leaves the site (as `/_events/promo`).
	const back = new URL(safeReturnTo(text(form, "returnTo"), url.origin) ?? "/", "http://x");
	const occurrenceId = text(form, "occurrenceId");
	const ticketTypeId = text(form, "ticketTypeId");
	const turnstileToken = text(form, "cf-turnstile-response");
	const joined = await callPublicRoute(
		{ locals, url, request },
		{
			method: "POST",
			path: "public/waitlist/join",
			pluginId: options.pluginId,
			body: {
				eventId,
				...(occurrenceId ? { occurrenceId } : {}),
				...(ticketTypeId ? { ticketTypeId } : {}),
				name: text(form, "name"),
				email: text(form, "email"),
				qty: Number.parseInt(text(form, "qty"), 10) || 1,
				...(turnstileToken ? { turnstileToken } : {}),
			},
		},
	);
	back.searchParams.set(PARAM, joined.ok ? "joined" : joined.error.code);
	back.searchParams.set(WIDGET_PARAMS.event, eventId);
	return redirect(`${back.pathname}${back.search}#${anchorId(eventId)}`, 303);
}
