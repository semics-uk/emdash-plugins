/**
 * Buying and showing gift vouchers on the site (T168, T163 §4, §5): glue between the site's pages and Vouchers'
 * public routes, in process. No JavaScript needed.
 *
 * - `<BuyVoucher>` renders what `public/options` offers and posts to `/_vouchers/buy`.
 * - `/_vouchers/buy` (`handleBuyRequest`): refuses cross-site posts, reads the form (`readBuyForm`), asks Vouchers'
 *   `public/purchase` (which checks everything against its settings and prices activities itself) and sends the
 *   buyer to Stripe Checkout with a 303. A refusal goes back to the form with its code and the fields to fix,
 *   never what was typed (`?voucher_error=&voucher_fields=`).
 * - `/_vouchers/thanks`: Stripe's return page. The voucher arrives by email (the webhook issues it).
 * - `/_vouchers/v?c=<code>` (`loadVoucher`): the voucher page from Vouchers' `public/redeem/check`, with print styles.
 *
 * Web APIs only, no `@semics-tech/shared` (R35); prices and rules stay in Vouchers.
 */

import { callPublicRoute, type PublicRouteContext } from "@semics-tech/emdash-events/astro/lib/call";
import { isCrossSiteRequest } from "@semics-tech/emdash-events/astro/lib/checkout-form";
import { isPayUrl } from "@semics-tech/emdash-events/astro/lib/payment";

export const BUY_PATH = "/_vouchers/buy";
export const THANKS_PATH = "/_vouchers/thanks";
export const VOUCHER_PAGE_PATH = "/_vouchers/v";

export type Delivery = "email-buyer" | "email-recipient" | "print" | "post";

/** What Vouchers' `public/options` answers (T168). */
export interface BuyOptions {
	kinds: Array<"money" | "activity">;
	moneyAmounts: number[];
	moneyCustom: { min: number; max: number } | null;
	activities: Array<{ eventId: string; ticketTypeId: string; priceMinor: number; label: string }>;
	delivery: Delivery[];
	scheduledSend: boolean;
	currency: string;
	validityMonths: number;
	turnstileSiteKey?: string;
}

/** What the voucher page shows (Vouchers' `voucherView`). */
export interface VoucherView {
	kind: "money" | "activity";
	currency: string;
	amountMinor: number;
	balanceMinor: number;
	usesLeft: number;
	heldMinor: number;
	label: string | null;
	status: string;
	expiresAt: string;
	toName: string | null;
	fromName: string;
	message: string | null;
}

/** The messages a refused purchase shows, by code; anything else is INTERNAL's. */
export const BUY_MESSAGES: Record<string, string> = {
	BAD_REQUEST: "Please check the highlighted fields.",
	TURNSTILE_FAILED: "We could not check you are not a robot. Please try again.",
	RATE_LIMITED: "Too many tries. Please wait a few minutes and try again.",
	PAYMENT_FAILED: "We could not start the payment. Please try again later.",
	LICENCE_REQUIRED: "Gift vouchers are not on sale on this site yet.",
	LICENCE_INVALID: "Gift vouchers are not on sale on this site yet.",
	INTERNAL: "Something went wrong. Please try again.",
};

export const BUY_FIELDS = [
	"kind",
	"amount",
	"activity",
	"buyerName",
	"buyerEmail",
	"recipientName",
	"recipientEmail",
	"message",
	"delivery",
	"address",
	"sendOn",
] as const;
export type BuyField = (typeof BUY_FIELDS)[number];

const DELIVERIES: readonly Delivery[] = ["email-buyer", "email-recipient", "print", "post"];
const EMAIL = /^[^\s@<>()",;:\\[\]]{1,64}@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/;
const ID64 = /^[A-Za-z0-9_-]{1,64}$/;
const CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

const field = (form: FormData, name: string) => {
	const v = form.get(name);
	return typeof v === "string" ? v.trim() : "";
};

/** Minor units of `currency` (2 for GBP), from Intl; 2 when Intl does not know it. */
export function minorDigits(currency: string): number {
	try {
		return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
	} catch {
		return 2;
	}
}

/** A typed amount in major units ("42.50") as minor units, or null. */
function toMinor(text: string, currency: string): number | null {
	const digits = minorDigits(currency);
	const m = /^(\d{1,7})(?:\.(\d+))?$/.exec(text);
	if (!m || (m[2] ?? "").length > digits) return null;
	return Number(m[1]) * 10 ** digits + Number((m[2] ?? "").padEnd(digits, "0") || 0);
}

/** "£50.00" in the site's currency, for the form and the voucher page. */
export function formatMinor(minor: number, currency: string): string {
	const digits = minorDigits(currency);
	try {
		return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(minor / 10 ** digits);
	} catch {
		return `${(minor / 10 ** digits).toFixed(digits)} ${currency}`;
	}
}

export type BuyFormResult = { ok: true; input: Record<string, unknown> } | { ok: false; fields: BuyField[] };

/** The form as `public/purchase` takes it, or the fields to fix. Vouchers checks it all again. */
export function readBuyForm(form: FormData): BuyFormResult {
	const bad: BuyField[] = [];
	const currency = /^[A-Z]{3}$/.test(field(form, "currency")) ? field(form, "currency") : "GBP";
	const kind = field(form, "kind");
	const input: Record<string, unknown> = { kind };
	if (kind === "money") {
		const amount = field(form, "amount");
		const minor =
			amount === "other"
				? toMinor(field(form, "otherAmount"), currency)
				: /^\d{1,9}$/.test(amount)
					? Number(amount)
					: null;
		if (!minor) bad.push("amount");
		else input.amountMinor = minor;
	} else if (kind === "activity") {
		const [eventId = "", ticketTypeId = "", extra] = field(form, "activity").split("/");
		if (!ID64.test(eventId) || !ID64.test(ticketTypeId) || extra !== undefined) bad.push("activity");
		else input.activity = { eventId, ticketTypeId };
	} else bad.push("kind");

	const name = field(form, "buyerName");
	const email = field(form, "buyerEmail");
	if (!name || name.length > 120) bad.push("buyerName");
	if (!EMAIL.test(email) || email.length > 254) bad.push("buyerEmail");
	input.buyer = { name, email };

	const delivery = (field(form, "delivery") || "email-buyer") as Delivery;
	if (!DELIVERIES.includes(delivery)) bad.push("delivery");
	input.delivery = delivery;
	const rName = field(form, "recipientName");
	const rEmail = field(form, "recipientEmail");
	if (rEmail && !EMAIL.test(rEmail)) bad.push("recipientEmail");
	else if (delivery === "email-recipient" && !rEmail) bad.push("recipientEmail");
	if (rName || rEmail) input.recipient = { ...(rName ? { name: rName } : {}), ...(rEmail ? { email: rEmail } : {}) };
	const message = field(form, "message");
	if (message.length > 500) bad.push("message");
	else if (message) input.message = message;
	if (delivery === "post") {
		const address = field(form, "address");
		if (!address) bad.push("address");
		else input.address = address;
	}
	const sendOn = field(form, "sendOn");
	if (sendOn && delivery === "email-recipient") {
		if (!/^\d{4}-\d{2}-\d{2}$/.test(sendOn)) bad.push("sendOn");
		else input.sendOn = sendOn;
	}
	const token = field(form, "cf-turnstile-response");
	if (token) input.turnstileToken = token;
	input.returnPath = THANKS_PATH;
	return bad.length > 0 ? { ok: false, fields: bad } : { ok: true, input };
}

/** A same-site path to go back to, or "/". */
function backTo(raw: string, origin: string): string {
	if (!raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
	try {
		const url = new URL(raw, origin);
		return url.origin === origin ? url.pathname : "/";
	} catch {
		return "/";
	}
}

const errorLocation = (path: string, code: string, fields: readonly string[]) => {
	const q = new URLSearchParams({ voucher_error: code });
	if (fields.length > 0) q.set("voucher_fields", fields.join(","));
	return `${path}?${q}`;
};

/** A refusal read back for the form: its code (known form) and fields, or null. */
export function readBuyState(url: URL): { code: string; fields: BuyField[] } | null {
	const code = url.searchParams.get("voucher_error") ?? "";
	if (!CODE.test(code)) return null;
	const fields = (url.searchParams.get("voucher_fields") ?? "")
		.split(",")
		.filter((f): f is BuyField => (BUY_FIELDS as readonly string[]).includes(f));
	return { code, fields };
}

export type BuyOutcome = { type: "redirect"; location: string } | { type: "forbidden" };

export interface BuyRequestContext {
	locals: PublicRouteContext["locals"];
	url: URL;
	request: Request;
}

/** `POST /_vouchers/buy`. */
export async function handleBuyRequest(ctx: BuyRequestContext, ids: { vouchersPluginId: string }): Promise<BuyOutcome> {
	if (isCrossSiteRequest(ctx.request, ctx.url)) return { type: "forbidden" };
	const form = await ctx.request.formData().catch(() => new FormData());
	const back = backTo(field(form, "returnTo"), ctx.url.origin);
	const read = readBuyForm(form);
	if (!read.ok) return { type: "redirect", location: errorLocation(back, "BAD_REQUEST", read.fields) };
	const out = await callPublicRoute<{ url?: unknown }>(
		{ locals: ctx.locals, url: ctx.url, request: ctx.request },
		{ method: "POST", path: "public/purchase", pluginId: ids.vouchersPluginId, body: read.input },
	).catch(() => null);
	if (out?.ok) {
		return isPayUrl(out.data.url)
			? { type: "redirect", location: out.data.url }
			: { type: "redirect", location: errorLocation(back, "PAYMENT_FAILED", []) };
	}
	const code = out?.error.code && CODE.test(out.error.code) ? out.error.code : "INTERNAL";
	return { type: "redirect", location: errorLocation(back, code, []) };
}

/** What `<BuyVoucher>` offers, from Vouchers' `public/options`; null when Vouchers cannot be reached. */
export async function loadBuyOptions(ctx: PublicRouteContext, vouchersPluginId: string): Promise<BuyOptions | null> {
	const out = await callPublicRoute<BuyOptions>(ctx, {
		method: "POST",
		path: "public/options",
		pluginId: vouchersPluginId,
		body: {},
	}).catch(() => null);
	return out?.ok ? out.data : null;
}

const ALPHABET = /^[0-9A-HJKMNP-TV-Z]{16}$/;

/** A typed code in its display form `XXXX-XXXX-XXXX-XXXX` (voucher/1 §7 normalisation), or null. */
export function displayCode(text: string): string | null {
	if (text.length > 64) return null;
	const raw = text.replace(/[\s-]/g, "");
	if (!/^[A-Za-z0-9]{16}$/.test(raw)) return null;
	const code = raw.toUpperCase().replace(/O/g, "0").replace(/[IL]/g, "1");
	return ALPHABET.test(code) ? (code.match(/.{4}/g) as string[]).join("-") : null;
}

export type VoucherLoad = { ok: true; voucher: VoucherView; display: string } | { ok: false; code: string };

/** The voucher page's read: Vouchers' `public/redeem/check` with the code alone. */
export async function loadVoucher(
	ctx: PublicRouteContext,
	code: string,
	vouchersPluginId: string,
): Promise<VoucherLoad> {
	const display = displayCode(code);
	if (!display) return { ok: false, code: "VOUCHER_INVALID" };
	const out = await callPublicRoute<{ voucher?: VoucherView }>(ctx, {
		method: "POST",
		path: "public/redeem/check",
		pluginId: vouchersPluginId,
		body: { code },
	}).catch(() => null);
	if (out?.ok && out.data.voucher) return { ok: true, voucher: out.data.voucher, display };
	return { ok: false, code: out && !out.ok && CODE.test(out.error.code) ? out.error.code : "VOUCHER_UNAVAILABLE" };
}
