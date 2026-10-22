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

const li = (items: readonly string[]) => items.map((i) => `<li>${escapeHtml(i)}</li>`).join("");
const link = (href: string, label: string) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`;

function details(i: Pick<BookingEmailInput, "event" | "bookingRef">): string[] {
	return [
		`When: ${formatWhen(i.event)}`,
		...(i.event.venue ? [`Where: ${i.event.venue}`] : []),
		`Reference: ${i.bookingRef}`,
	];
}

export function confirmationEmail(i: BookingEmailInput): OutboxMessage {
	const ticketsUrl = `${i.bookingUrl}#tickets`;
	const lines = details(i);
	const text = [
		`Hi ${i.buyerName},`,
		"",
		`Your booking for ${i.event.title} is confirmed.`,
		"",
		...lines,
		"",
		"Tickets:",
		...i.attendees.map((a) => `- ${a}`),
		"",
		`View or cancel your booking: ${i.bookingUrl}`,
		`Your tickets (check-in passes): ${ticketsUrl}`,
		`Add to calendar: ${i.calendarUrl}`,
		"",
		"The booking link opens your booking once on the device you use it from, so keep this email private.",
		`${i.siteName}`,
	].join("\n");
	const html = [
		`<p>Hi ${escapeHtml(i.buyerName)},</p>`,
		`<p>Your booking for <strong>${escapeHtml(i.event.title)}</strong> is confirmed.</p>`,
		`<p>${lines.map(escapeHtml).join("<br>")}</p>`,
		`<p>Tickets:</p><ul>${li(i.attendees)}</ul>`,
		`<p>${link(i.bookingUrl, "View or cancel your booking")}<br>${link(ticketsUrl, "Your tickets (check-in passes)")}<br>${link(i.calendarUrl, "Add to calendar")}</p>`,
		"<p>The booking link opens your booking once on the device you use it from, so keep this email private.</p>",
		`<p>${escapeHtml(i.siteName)}</p>`,
	].join("\n");
	return { to: i.to, subject: `Your booking: ${i.event.title}`, text, html };
}

export function cancellationEmail(i: Omit<BookingEmailInput, "bookingUrl"> & { bookingUrl?: string }): OutboxMessage {
	const lines = details(i);
	const text = [
		`Hi ${i.buyerName},`,
		"",
		`Your booking for ${i.event.title} has been cancelled.`,
		"",
		...lines,
		"",
		"If you did not ask for this, contact the organiser and quote the reference.",
		`${i.siteName}`,
	].join("\n");
	const html = [
		`<p>Hi ${escapeHtml(i.buyerName)},</p>`,
		`<p>Your booking for <strong>${escapeHtml(i.event.title)}</strong> has been cancelled.</p>`,
		`<p>${lines.map(escapeHtml).join("<br>")}</p>`,
		"<p>If you did not ask for this, contact the organiser and quote the reference.</p>",
		`<p>${escapeHtml(i.siteName)}</p>`,
	].join("\n");
	return { to: i.to, subject: `Booking cancelled: ${i.event.title}`, text, html };
}
