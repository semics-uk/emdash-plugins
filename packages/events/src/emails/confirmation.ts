import { isValidTimeZone, type OutboxMessage, utcOffsetMinutes, utcToZoned } from "@semics-tech/shared";

import type { EventInfo } from "../domain/event-info";

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
const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "Sat 14 Nov 2026, 19:00 UTC+1 (Europe/London)" in the event's own zone (UTC when it has none or
 * it is invalid). Built from zone parts, not `Intl` names, so workerd and Node agree.
 */
export function formatWhen(event: Pick<EventInfo, "startsAt" | "timeZone">): string {
	const zone = event.timeZone && isValidTimeZone(event.timeZone) ? event.timeZone : "UTC";
	const t = utcToZoned(event.startsAt, zone);
	const weekday = DAYS[new Date(Date.UTC(t.year, t.month - 1, t.day)).getUTCDay()];
	const offset = utcOffsetMinutes(event.startsAt, zone);
	const abs = Math.abs(offset);
	const utc =
		offset === 0 ? "UTC" : `UTC${offset < 0 ? "-" : "+"}${Math.floor(abs / 60)}${abs % 60 ? `:${pad(abs % 60)}` : ""}`;
	return `${weekday} ${t.day} ${MONTHS[t.month - 1]} ${t.year}, ${pad(t.hour)}:${pad(t.minute)} ${utc} (${zone})`;
}

// Plain sentences (nothing to escape), in both the text and the HTML part.
const KEEP_PRIVATE =
	"The booking link opens your booking once on the device you use it from, so keep this email private.";
const NOT_YOU = "If you did not ask for this, contact the organiser and quote the reference.";

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
			["Your tickets (check-in passes)", `${i.bookingUrl}#tickets`],
			["Add to calendar", i.calendarUrl],
		],
		closing: KEEP_PRIVATE,
	});
}

export function cancellationEmail(i: Omit<BookingEmailInput, "bookingUrl"> & { bookingUrl?: string }): OutboxMessage {
	return compose(i, "Booking cancelled", ["Your booking for ", " has been cancelled."], { closing: NOT_YOU });
}

/** A waitlist offer (T081): the claim link holds a one-time code, valid until `expiresAt` (ISO). */
export function offerEmail(
	i: Pick<BookingEmailInput, "to" | "buyerName" | "bookingRef" | "event" | "bookingUrl" | "siteName"> & {
		seats: number;
		expiresAt: string;
	},
): OutboxMessage {
	const held = `${i.seats} ticket${i.seats === 1 ? " is" : "s are"} held for you until ${i.expiresAt.slice(0, 16).replace("T", " ")} UTC.`;
	return compose(i, "Tickets available", ["A place has come up for ", `: ${held}`], {
		links: [["Claim your tickets", i.bookingUrl]],
		closing: KEEP_PRIVATE,
	});
}
