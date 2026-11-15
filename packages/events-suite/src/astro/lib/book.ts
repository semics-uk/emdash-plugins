/**
 * "Book with this voucher" (T171). voucher/1 §8 lets a code travel in one URL only, the voucher page's own
 * `/_vouchers/v?c=<code>` (no referrer, no caching). So the button is that page again with `&book=1`: the page
 * puts the code in Events' short-lived HttpOnly voucher cookie and sends the buyer on with a 303, and the booking
 * form fills its Gift voucher field from the cookie on the server. No booking URL ever holds the code.
 *
 * Where it goes (`bookingTarget`):
 * - an activity voucher: its event's page (`page.eventPath`, default `/events/{slug}`) with `?ticketType=` and
 *   `#book-<event>`, when Events lists that event on sale with a slug (Vouchers never checks the ids it sells);
 * - a money voucher: the site's list of activities (`vouchers.book.listPath`, default `/events`);
 * - nowhere (no button) for a voucher with nothing left, one that is not active, or an event Events cannot find.
 */
import { bookAnchor, TICKET_TYPE_PARAM } from "@semics-tech/emdash-events/astro/lib/book-link";
import { callPublicRoute, type PublicRouteContext } from "@semics-tech/emdash-events/astro/lib/call";
import { eventPageHref } from "@semics-tech/emdash-events/astro/lib/page";

import { VOUCHER_PAGE_PATH, type VoucherView } from "./buy";

export const BOOK_PARAM = "book";

export interface BookOptions {
	eventsPluginId: string;
	/** Where a money voucher's button goes. */
	listPath: string;
	/** The site's event page, a path with `{slug}`. */
	eventPath?: string | undefined;
}

/** The button's link: the voucher page's own URL, asking it to hand the code to the booking form. */
export const bookHref = (display: string) => `${VOUCHER_PAGE_PATH}?c=${display}&${BOOK_PARAM}=1`;

export const wantsBooking = (url: URL) => url.searchParams.get(BOOK_PARAM) === "1";

const usable = (v: VoucherView) => v.status === "active" && (v.kind === "money" ? v.balanceMinor > 0 : v.usesLeft > 0);

/** Where the voucher's button goes, or null for no button. */
export async function bookingTarget(
	ctx: PublicRouteContext,
	v: VoucherView,
	opts: BookOptions,
): Promise<string | null> {
	if (!usable(v)) return null;
	if (v.kind === "money") return opts.listPath;
	const { eventId, ticketTypeId } = v;
	if (!eventId || !ticketTypeId) return null;
	const list = await callPublicRoute<{ events?: Array<{ eventId: string; slug?: string; status?: string }> }>(ctx, {
		path: "public/events",
		pluginId: opts.eventsPluginId,
	}).catch(() => null);
	const event = list?.ok ? (list.data.events ?? []).find((e) => e.eventId === eventId) : undefined;
	const page = event?.status === "on_sale" ? eventPageHref(event.slug, opts.eventPath) : undefined;
	if (!page) return null;
	return `${page}${page.includes("?") ? "&" : "?"}${TICKET_TYPE_PARAM}=${encodeURIComponent(ticketTypeId)}#${bookAnchor(eventId)}`;
}
