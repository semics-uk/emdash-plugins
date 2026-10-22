/**
 * The opt-out page for reminder and update emails (EV-FR-08, T083, R57). Events Pro's reminders and
 * update notices link to `/_events/opt-out?ref=<booking ref>&w=<recipient>&s=<signature>`. Opening the
 * link changes nothing (a mail scanner that prefetches it unsubscribes no one); the page shows a
 * button whose same-site POST asks the core's `public/mail/opt-out`. The route is Events Pro's: a Free
 * core answers NOT_FOUND, which the page shows as an invalid link. Cancellation notices are always sent.
 */
import { callPublicRoute, type PublicRouteContext } from "./call";

export const OPT_OUT_PATH = "/_events/opt-out";

export interface OptOutLink {
	bookingRef: string;
	/** `buyer`, or the seat's attendee id. */
	who: string;
	sig: string;
}

export const OPT_OUT_MESSAGES = {
	done: "Done. You will get no more reminders or updates about this booking at this address. If the event is cancelled, we will still tell you.",
	invalid: "This link is not valid any more. Use the link in the most recent email about your booking.",
} as const;

const REF = /^[0-9A-Z]{10}$/;
const WHO = /^[\w-]{1,120}$/;
const SIG = /^[0-9a-f]{32}$/;

/** The link's values from the page's query (GET) or its form (POST); null when malformed. */
export function readOptOutLink(source: { get(name: string): unknown }): OptOutLink | null {
	const [bookingRef, who, sig] = ["ref", "w", "s"].map((k) => {
		const v = source.get(k);
		return typeof v === "string" ? v : "";
	}) as [string, string, string];
	return REF.test(bookingRef) && WHO.test(who) && SIG.test(sig) ? { bookingRef, who, sig } : null;
}

/** The button's POST: `done`, or `invalid` for any refusal (also a core without the route). */
export async function optOut(
	ctx: PublicRouteContext,
	link: OptOutLink,
	options: { pluginId?: string },
): Promise<keyof typeof OPT_OUT_MESSAGES> {
	const result = await callPublicRoute(ctx, {
		method: "POST",
		path: "public/mail/opt-out",
		pluginId: options.pluginId,
		body: link,
	});
	return result.ok ? "done" : "invalid";
}
