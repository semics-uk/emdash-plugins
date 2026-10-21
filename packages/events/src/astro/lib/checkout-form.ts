import { callPublicRoute, type PublicRouteContext } from "./call";
import {
	fieldsFromIssues,
	newIdempotencyKey,
	safeReturnTo,
	validateCheckoutFields,
	type WidgetField,
	widgetErrorLocation,
} from "./widget";

export interface CheckoutFormOptions {
	/** The core's plugin id. Defaults to the slug; registry installs pass their `r_…` id. */
	pluginId?: string;
	/** Injected for tests: makes the idempotency key when the form carries none. */
	newKey?: () => string;
}

export interface CheckoutRedirect {
	location: string;
	/** The booking's access token, for an HttpOnly cookie scoped to `/booking`. Never in a URL. */
	cookie?: { name: string; value: string };
}

export const BOOKING_PATH = "/booking";
/** Where the booking widget's form posts (injected by `eventsIntegration`). */
export const CHECKOUT_PATH = "/_events/checkout";
export const bookingCookieName = (ref: string) => `semics_booking_${ref}`;

export const QTY_PREFIX = "qty:";

function text(form: FormData, key: string): string {
	const value = form.get(key);
	return typeof value === "string" ? value.trim() : "";
}

function fail(code: string, ref?: string, cookie?: CheckoutRedirect["cookie"]): CheckoutRedirect {
	const query = new URLSearchParams();
	if (ref) query.set("ref", ref);
	query.set("error", code);
	return { location: `${BOOKING_PATH}?${query}`, ...(cookie ? { cookie } : {}) };
}

/**
 * The no-JS checkout (`POST /_events/checkout`): reserve, then continue, through the public routes
 * only. The access token goes back as a cookie value, never in the redirect URL.
 *
 * A form from the booking widget carries `returnTo` (its own page): anything refused before a
 * booking exists goes back there with the error code and the names of the fields to fix, never
 * the values typed. Without a usable `returnTo`, refusals land on the booking page as before.
 */
export async function handleCheckoutForm(
	ctx: PublicRouteContext,
	form: FormData,
	options: CheckoutFormOptions,
): Promise<CheckoutRedirect> {
	const pluginId = options.pluginId;
	const lines: Array<{ ticketTypeId: string; qty: number }> = [];
	for (const [key, value] of form.entries()) {
		if (!key.startsWith(QTY_PREFIX) || typeof value !== "string") continue;
		const qty = Number.parseInt(value, 10);
		if (qty > 0) lines.push({ ticketTypeId: key.slice(QTY_PREFIX.length), qty });
	}
	const eventId = text(form, "eventId");
	const returnTo = safeReturnTo(text(form, "returnTo"), ctx.url.origin);
	const refuse = (code: string, fields: WidgetField[] = []) =>
		returnTo && eventId ? { location: widgetErrorLocation(returnTo, eventId, code, fields) } : fail(code);
	if (!eventId) return fail("BAD_REQUEST");

	const occurrenceId = text(form, "occurrenceId");
	const buyer = { name: text(form, "name"), email: text(form, "email") };
	const invalid = validateCheckoutFields({
		...buyer,
		lines: lines.length,
		needsOccurrence: form.get("needsOccurrence") === "1",
		occurrenceId,
	});
	if (invalid.length > 0) return refuse("BAD_REQUEST", invalid);

	const turnstileToken = text(form, "cf-turnstile-response");
	const reserved = await callPublicRoute<{ bookingRef: string; accessToken?: string }>(ctx, {
		method: "POST",
		path: "public/checkout/reserve",
		pluginId,
		body: {
			eventId,
			...(occurrenceId ? { occurrenceId } : {}),
			lines,
			buyer,
			idempotencyKey: text(form, "idempotencyKey") || (options.newKey ?? newIdempotencyKey)(),
			...(turnstileToken ? { turnstileToken } : {}),
		},
	});
	if (!reserved.ok) {
		const { code, issues } = reserved.error;
		return refuse(code, code === "BAD_REQUEST" ? fieldsFromIssues(issues) : []);
	}

	const { bookingRef, accessToken } = reserved.data;
	const done = `${BOOKING_PATH}?ref=${encodeURIComponent(bookingRef)}`;
	// A resubmit of a booking that is already confirmed gets no new token: this browser has its cookie.
	if (!accessToken) return { location: done };
	const cookie = { name: bookingCookieName(bookingRef), value: accessToken };
	const next = await callPublicRoute<{ next?: { type?: string; url?: string } }>(ctx, {
		method: "POST",
		path: "public/checkout/continue",
		pluginId,
		body: { bookingRef, accessToken },
	});
	if (!next.ok) return fail(next.error.code, bookingRef, cookie);

	const step = next.data.next;
	if (step?.type === "pay" && step.url) return { location: step.url, cookie };
	return { location: done, cookie };
}
