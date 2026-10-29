/**
 * The booking page's attendee signing list (T133, R95; Suite Pro). Events Pro's `public/booking`
 * describes each seat of a waiver booking (`seat`, `signing`, `signs`, `email`, `minor`) and whether
 * names may still be changed (`signingList.editable`, until `attendeeEditCutoffHours` before the
 * start); Free sends none of it, so `signingRows` is null and the page shows nothing new.
 *
 * The list's forms post back to `/booking` (no JavaScript needed). `handleAttendeeAction` calls the
 * Pro routes with the cookie's access token, never a form field, and redeems what they mint with
 * e-sign in-process:
 *
 * - Sign now (`intent=sign-now`): `public/booking/attendees/sign` mints one inline intent for the
 *   seat (the attendee signs for themselves on this device; a minor's guardian signs for them), which
 *   `startDoorSigning` redeems before sending the browser to e-sign's signing page.
 * - Resend (`intent=resend`, emailed adults): `public/booking/attendees/resend` mints a `resend`
 *   intent; e-sign emails the open envelope's invitation again (rate limited by Events Pro).
 * - Save (`intent=attendees`): `public/booking/attendees` stores the corrected names and emails and
 *   mints, per changed seat, a `replace` intent (e-sign voids the old envelope) and, for an emailed
 *   adult, the new invitation's intent, redeemed in that order.
 *
 * Every outcome is a redirect to `/booking?ref=` with a code, never a typed value. Web APIs only (R35).
 */
import { callPublicRoute, type PublicRouteContext } from "./call";
import { BOOKING_PATH } from "./checkout-form";
import { type ReceiptOptions, startDoorSigning } from "./receipt";
import type { BookingView } from "./widget";

/** What Events Pro adds to each attendee of a waiver booking's `public/booking` answer. */
export interface SigningAttendee {
	name: string;
	seat?: string;
	email?: string;
	minor?: boolean;
	signing?: "signed" | "waiting";
	/** `email`: an adult e-sign invites by email; `inline`: signed on the buyer's device. */
	signs?: "inline" | "email";
}

export interface SigningRow {
	seat: string;
	name: string;
	email: string;
	minor: boolean;
	signed: boolean;
	canSign: boolean;
	canResend: boolean;
	canEdit: boolean;
}

export interface AttendeeEdit {
	seat: string;
	name: string;
	email?: string;
}

/** Statuses in which a waiver can still be signed: the hold's, and a confirmed booking's pending seats. */
const OPEN = ["awaiting_signature", "awaiting_payment", "confirmed"];
const SEAT = /^[0-9]{1,3}$/;
const CODE = /^[A-Z_]{1,40}$/;
const MAX_TEXT = 254;
/** Issue codes of a refused save the page explains itself; any other issue is an invalid entry. */
const ISSUE_CODES = ["ATTENDEE_SIGNED", "WAIVER_EMAIL_REQUIRED", "WAIVER_TOO_MANY_EMAILS", "RATE_LIMITED"];

/** The list's rows, or null when the answer has no signing list (Free, or not a waiver booking). */
export function signingRows(booking: BookingView): SigningRow[] | null {
	const list = booking.signingList;
	if (!list) return null;
	const open = OPEN.includes(booking.status);
	const rows: SigningRow[] = [];
	for (const a of booking.attendees as SigningAttendee[]) {
		if (typeof a.seat !== "string" || !SEAT.test(a.seat) || !a.signing) continue;
		const signed = a.signing === "signed";
		const waiting = open && !signed;
		rows.push({
			seat: a.seat,
			name: a.name,
			email: a.email ?? "",
			minor: a.minor === true,
			signed,
			canSign: waiting,
			canResend: waiting && a.signs === "email",
			canEdit: waiting && list.editable === true,
		});
	}
	return rows.length > 0 ? rows : null;
}

const text = (form: FormData, key: string): string | undefined => {
	const value = form.get(key);
	return typeof value === "string" ? value.trim().slice(0, MAX_TEXT) : undefined;
};

/** The edit form's values for the editable seats (`name:<seat>`, `email:<seat>`); a minor has no email. */
export function readAttendeeEdits(form: FormData, rows: readonly SigningRow[]): AttendeeEdit[] {
	return rows
		.filter((r) => r.canEdit)
		.map((r) => {
			const name = text(form, `name:${r.seat}`) ?? r.name;
			if (r.minor) return { seat: r.seat, name };
			return { seat: r.seat, name, email: text(form, `email:${r.seat}`) ?? r.email };
		});
}

const post = <T>(ctx: PublicRouteContext, pluginId: string | undefined, path: string, body: unknown) =>
	callPublicRoute<T>(ctx, { method: "POST", path, body, ...(pluginId ? { pluginId } : {}) });

function back(ref: string, key: "error" | "attendees", value: string): { location: string } {
	const query = new URLSearchParams({ ref });
	query.set(key, key === "error" && !CODE.test(value) ? "INTERNAL" : value);
	return { location: `${BOOKING_PATH}?${query}` };
}

interface Minted {
	intent?: unknown;
	lookup?: unknown;
	intents?: Array<{ token?: unknown }>;
}

/**
 * Handles the list's posts (`intent` = `sign-now`, `resend` or `attendees`); null for any other
 * form. `booking` is the page's fresh `public/booking` answer, so only offered actions are sent.
 */
export async function handleAttendeeAction(
	ctx: PublicRouteContext,
	form: FormData,
	access: { ref: string; token: string },
	options: ReceiptOptions,
	booking: BookingView,
): Promise<{ location: string } | null> {
	const intent = form.get("intent");
	if (intent !== "sign-now" && intent !== "resend" && intent !== "attendees") return null;
	const { ref } = access;
	if (!options.esignPluginId) return back(ref, "error", "ESIGN_NOT_CONFIGURED");
	const rows = signingRows(booking) ?? [];
	const auth = { bookingRef: ref, accessToken: access.token };

	if (intent === "attendees") {
		const attendees = readAttendeeEdits(form, rows);
		if (attendees.length === 0) return back(ref, "error", "ATTENDEES_LOCKED");
		const saved = await post<Minted>(ctx, options.pluginId, "public/booking/attendees", { ...auth, attendees });
		if (!saved.ok) {
			const issue = saved.error.issues?.find((i) => ISSUE_CODES.includes(String(i.code)));
			if (issue) return back(ref, "error", String(issue.code));
			return back(ref, "error", saved.error.code === "BAD_REQUEST" ? "ATTENDEE_INVALID" : saved.error.code);
		}
		// In order: each changed seat's `replace` (void the old envelope) before its new invitation.
		for (const minted of saved.data.intents ?? []) {
			const redeemed = await post(ctx, options.esignPluginId, "public/envelopes/from-intent", {
				intent: minted.token,
			});
			if (!redeemed.ok) return back(ref, "error", "ATTENDEES_UNSENT");
		}
		return back(ref, "attendees", "saved");
	}

	const seat = form.get("seat");
	const row = rows.find((r) => r.seat === seat);
	if (!row || !(intent === "resend" ? row.canResend : row.canSign)) return back(ref, "error", "BAD_REQUEST");
	if (intent === "resend") {
		const minted = await post<Minted>(ctx, options.pluginId, "public/booking/attendees/resend", { ...auth, seat });
		if (!minted.ok) return back(ref, "error", minted.error.code);
		const sent = await post(ctx, options.esignPluginId, "public/envelopes/from-intent", { intent: minted.data.intent });
		return sent.ok ? back(ref, "attendees", "resent") : back(ref, "error", "SIGNING_UNAVAILABLE");
	}
	const minted = await post<Minted>(ctx, options.pluginId, "public/booking/attendees/sign", { ...auth, seat });
	if (!minted.ok) return back(ref, "error", minted.error.code);
	const started = await startDoorSigning(ctx, minted.data.intent, options, minted.data.lookup);
	if ("location" in started) return started;
	if ("signed" in started) return { location: `${BOOKING_PATH}?ref=${ref}&waiver=signed` };
	return back(ref, "error", started.error);
}
