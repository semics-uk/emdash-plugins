import { type OutboxMessage, pad2, utcToZoned, validZone } from "@semics-tech/shared";

import type { EventInfo } from "../domain/event-info";
import { AWAITING_APPROVAL } from "../domain/names";
import { msOf } from "../domain/time";
import type { BookingDoc, OutboxDoc } from "../storage/schema";

/**
 * Booking emails (EV-FR-08, EV-FR-09). Bodies are built with a plain `fill`, not `renderTemplate`,
 * whose Markdown escaping corrupts base64url tokens and hyphenated names (R32); every value that
 * reaches the HTML part goes through `escapeHtml`. No attachment: the calendar link is a URL.
 */
export interface BookingEmailInput {
	to: string;
	buyerName: string;
	bookingRef: string;
	/** Attendee names, one per ticket. */
	attendees: readonly string[];
	event: EventInfo;
	/** The booking page link, with the one-time code (confirmation only). */
	bookingUrl: string;
	/** The public event calendar file. */
	calendarUrl: string;
	siteName: string;
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = pad2;

/**
 * "Sat 14 Nov 2026, 19:00 (Europe/London)": plain local time in the event's own zone (UTC when it has
 * none or it is invalid). Built from zone parts, not `Intl` names, so workerd and Node agree.
 */
export function formatWhen(event: Pick<EventInfo, "startsAt" | "timeZone">): string {
	const zone = validZone(event.timeZone) ?? "UTC";
	const t = utcToZoned(event.startsAt, zone);
	const weekday = DAYS[new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay()];
	return `${weekday} ${t.day} ${MONTHS[t.month - 1]} ${t.year}, ${pad(t.hour)}:${pad(t.minute)} (${zone})`;
}

// Plain sentences (nothing to escape), in both the text and the HTML part.
const KEEP_PRIVATE = "Keep this email private: its link opens your booking once.";
const NOT_YOU = "Not you? Contact the organiser and quote the reference.";

/** An instant (ISO), such as a deadline, in the event's own zone. */
const zoned = (at: string, event: EventInfo) => {
	const startsAt = msOf(at);
	return startsAt ? formatWhen({ startsAt, timeZone: event.timeZone }) : at; // `at` is a stored value: never lose the mail
};

const link = ([label, href]: readonly [string, string]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;

/**
 * The text and HTML parts from the same pieces: greeting, an opening sentence (the event title in
 * bold), the event details, a list, links, a closing line and the site name. Every value is escaped.
 */
function compose(
	i: Pick<BookingEmailInput, "to" | "buyerName" | "bookingRef" | "event" | "siteName">,
	subject: string,
	[before, after]: readonly [string, string],
	{
		list = [],
		links = [],
		closing,
	}: { list?: readonly string[]; links?: ReadonlyArray<readonly [string, string]>; closing: string },
): OutboxMessage {
	const title = i.event.title;
	const lines = [
		`When: ${formatWhen(i.event)}`,
		...(i.event.venue ? [`Where: ${i.event.venue}`] : []),
		`Reference: ${i.bookingRef}`,
	];
	const text = [`Hi ${i.buyerName},`, "", `${before}${title}${after}`, "", ...lines, ""];
	const html = [
		`<p>Hi ${escapeHtml(i.buyerName)},</p>`,
		`<p>${escapeHtml(before)}<strong>${escapeHtml(title)}</strong>${escapeHtml(after)}</p>`,
		`<p>${lines.map(escapeHtml).join("<br>")}</p>`,
	];
	if (list.length > 0) {
		text.push("Tickets:", ...list.map((a) => `- ${a}`), "");
		html.push(`<p>Tickets:</p><ul>${list.map((a) => `<li>${escapeHtml(a)}</li>`).join("")}</ul>`);
	}
	if (links.length > 0) {
		text.push(...links.map(([label, href]) => `${label}: ${href}`), "");
		html.push(`<p>${links.map(link).join("<br>")}</p>`);
	}
	text.push(closing, i.siteName);
	html.push(`<p>${closing}</p>`, `<p>${escapeHtml(i.siteName)}</p>`);
	return { to: i.to, subject: `${subject}: ${title}`, text: text.join("\n"), html: html.join("\n") };
}

export function confirmationEmail(i: BookingEmailInput): OutboxMessage {
	return compose(i, "Your booking", ["Your booking for ", " is confirmed."], {
		list: i.attendees,
		links: [
			["View or cancel your booking", i.bookingUrl],
			["Your check-in passes", `${i.bookingUrl}#tickets`],
			["Add to calendar", i.calendarUrl],
		],
		closing: KEEP_PRIVATE,
	});
}

export function cancellationEmail(i: Omit<BookingEmailInput, "bookingUrl"> & { bookingUrl?: string }): OutboxMessage {
	return compose(i, "Booking cancelled", ["Your booking for ", " has been cancelled."], { closing: NOT_YOU });
}

/**
 * The approval notices (T131): to the buyer (request received, declined with the admin's reason,
 * expired) and to an admin (a new request or booking, with a link to the Bookings page: acting
 * needs an admin session, so the mail carries no token). Rendered at send time from the booking as it
 * is then: a request an admin has already approved reads "New booking" (nothing is left to decide),
 * and only one that has already ended sends the admin nothing.
 */
export function approvalEmail(
	{ kind, to }: Pick<OutboxDoc, "kind" | "to">,
	b: BookingDoc,
	event: EventInfo,
	siteName: string,
	adminUrl: string,
): OutboxMessage | null {
	const i = { to, buyerName: b.buyer.name, bookingRef: b.ref, event, siteName };
	if (kind === "approval_admin") {
		const waiting = b.status === AWAITING_APPROVAL;
		// Ended (declined, cancelled, expired, refunded*): nothing new to tell. Anything else is still live.
		if (/^(de|ca|ex|re)/.test(b.status)) return null;
		const seats = b.lines.reduce((n, l) => n + l.qty, 0);
		return compose(
			{ ...i, buyerName: "organiser" },
			waiting ? "Booking request" : "New booking",
			[
				`${b.buyer.name} (${b.email}) booked ${seats} for `,
				waiting
					? `. Decision needed: approve or decline by ${zoned(b.holdExpiresAt ?? "", event)}, or it expires.`
					: ".",
			],
			{ links: [["Open Bookings", adminUrl]], closing: "" },
		);
	}
	const notice: Record<string, readonly [string, string]> = {
		approval_requested: ["Booking request received", " awaits approval; we will email you."],
		approval_declined: ["Booking declined", ` was declined${b.declineReason ? `: ${b.declineReason}` : "."}`],
		approval_expired: ["Booking request expired", " was not approved in time."],
	};
	const n = notice[kind];
	const closing = `${b.notCharged ? "Your card was not charged. " : ""}${NOT_YOU}`;
	return n ? compose(i, n[0], ["Your booking request for ", n[1]], { closing }) : null;
}

/** A waitlist offer (T081): the claim link holds a one-time code, valid until `expiresAt` (ISO). */
export function offerEmail(
	i: Pick<BookingEmailInput, "to" | "buyerName" | "bookingRef" | "event" | "bookingUrl" | "siteName"> & {
		seats: number;
		expiresAt: string;
	},
): OutboxMessage {
	const held = `${i.seats} ticket${i.seats === 1 ? " is" : "s are"} held for you until ${zoned(i.expiresAt, i.event)}.`;
	return compose(i, "Tickets available", ["A place has come up for ", `: ${held}`], {
		links: [["Claim your tickets", i.bookingUrl]],
		closing: KEEP_PRIVATE,
	});
}
