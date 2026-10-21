import { callPublicRoute, type PublicRouteContext } from "./call";

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
export const bookingCookieName = (ref: string) => `semics_booking_${ref}`;

const QTY_PREFIX = "qty:";

function text(form: FormData, key: string): string {
	const value = form.get(key);
	return typeof value === "string" ? value.trim() : "";
}

function defaultKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
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
	if (lines.length === 0 || !eventId) return fail("BAD_REQUEST");

	const occurrenceId = text(form, "occurrenceId");
	const turnstileToken = text(form, "cf-turnstile-response");
	const reserved = await callPublicRoute<{ bookingRef: string; accessToken: string }>(ctx, {
		method: "POST",
		path: "public/checkout/reserve",
		pluginId,
		body: {
			eventId,
			...(occurrenceId ? { occurrenceId } : {}),
			lines,
			buyer: { name: text(form, "name"), email: text(form, "email") },
			idempotencyKey: text(form, "idempotencyKey") || (options.newKey ?? defaultKey)(),
			...(turnstileToken ? { turnstileToken } : {}),
		},
	});
	if (!reserved.ok) return fail(reserved.error.code);

	const { bookingRef, accessToken } = reserved.data;
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
	return { location: `${BOOKING_PATH}?ref=${encodeURIComponent(bookingRef)}`, cookie };
}
