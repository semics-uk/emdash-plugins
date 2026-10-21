/**
 * RFC 5545 iCalendar generation. Pure: all times are passed in (epoch ms), nothing reads the clock.
 *
 * - Lines end CRLF and are folded at 75 octets (UTF-8 safe), TEXT values are escaped.
 * - An event with `timeZone` gets `DTSTART;TZID=...` plus a generated VTIMEZONE (explicit transitions for
 *   the year before to the year after the event, from `Intl`).
 * - An event without `timeZone` is written in UTC (`...Z`); `allDay` writes `VALUE=DATE` using UTC dates.
 */
import { isValidTimeZone, utcOffsetMinutes, utcToZoned } from "./time";

export interface IcsEvent {
	/** Stable globally unique id; reuse it (with a higher `sequence`) to update or cancel. */
	uid: string;
	/** DTSTAMP instant (epoch ms): when this representation was created. */
	stamp: number;
	/** Start instant (epoch ms, UTC). */
	start: number;
	/** End instant (epoch ms, UTC); must be after `start`. For `allDay`, the exclusive end date. */
	end: number;
	summary: string;
	description?: string;
	location?: string;
	url?: string;
	/** IANA zone: emit local times with TZID and a VTIMEZONE. Omit for UTC. */
	timeZone?: string;
	allDay?: boolean;
	/** Raw RRULE value, e.g. "FREQ=WEEKLY;COUNT=4" (no "RRULE:" prefix). */
	rrule?: string;
	status?: "CONFIRMED" | "TENTATIVE" | "CANCELLED";
	sequence?: number;
}

export interface IcsCalendar {
	/** PRODID, e.g. "-//semics//events//EN". */
	prodId: string;
	/** iTIP METHOD (PUBLISH, REQUEST, CANCEL). Omit for a plain downloadable file. */
	method?: "PUBLISH" | "REQUEST" | "CANCEL";
	name?: string;
	events: IcsEvent[];
}

const encoder = new TextEncoder();

/** Escape a TEXT value: backslash, semicolon, comma, newlines. */
export function escapeText(value: string): string {
	return value
		.replace(/\\/g, "\\\\")
		.replace(/;/g, "\\;")
		.replace(/,/g, "\\,")
		.replace(/\r\n|\r|\n/g, "\\n");
}

/** Fold a content line to at most 75 octets per physical line, never splitting a UTF-8 character. */
export function foldLine(line: string): string {
	if (encoder.encode(line).length <= 75) return line;
	const out: string[] = [];
	let cur = "";
	let size = 0;
	let limit = 75;
	for (const ch of line) {
		const n = encoder.encode(ch).length;
		if (size + n > limit) {
			out.push(cur);
			cur = " ";
			size = 1;
			limit = 75;
		}
		cur += ch;
		size += n;
	}
	out.push(cur);
	return out.join("\r\n");
}

const p2 = (n: number) => String(n).padStart(2, "0");

function localStamp(p: { year: number; month: number; day: number; hour: number; minute: number; second: number }) {
	return `${String(p.year).padStart(4, "0")}${p2(p.month)}${p2(p.day)}T${p2(p.hour)}${p2(p.minute)}${p2(p.second)}`;
}

function utcStamp(ms: number): string {
	const d = new Date(ms);
	return `${localStamp({
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
		hour: d.getUTCHours(),
		minute: d.getUTCMinutes(),
		second: d.getUTCSeconds(),
	})}Z`;
}

function dateStamp(ms: number): string {
	return utcStamp(ms).slice(0, 8);
}

function offsetString(minutes: number): string {
	const sign = minutes < 0 ? "-" : "+";
	const abs = Math.abs(minutes);
	return `${sign}${p2(Math.floor(abs / 60))}${p2(abs % 60)}`;
}

/** Offset transitions of a zone within [from, to), located to the minute. */
function transitions(timeZone: string, from: number, to: number): { at: number; before: number; after: number }[] {
	const out: { at: number; before: number; after: number }[] = [];
	const day = 86_400_000;
	let prevT = from;
	let prevO = utcOffsetMinutes(from, timeZone);
	for (let t = from + day; t <= to; t += day) {
		const o = utcOffsetMinutes(t, timeZone);
		if (o !== prevO) {
			let lo = prevT;
			let hi = t;
			while (hi - lo > 60_000) {
				const mid = Math.floor((lo + hi) / 120_000) * 60_000;
				if (utcOffsetMinutes(mid, timeZone) === prevO) lo = mid;
				else hi = mid;
			}
			out.push({ at: hi, before: prevO, after: o });
		}
		prevT = t;
		prevO = o;
	}
	return out;
}

function vtimezone(timeZone: string, eventStart: number): string[] {
	const year = new Date(eventStart).getUTCFullYear();
	const from = Date.UTC(year - 1, 0, 1);
	const to = Date.UTC(year + 2, 0, 1);
	const lines = ["BEGIN:VTIMEZONE", `TZID:${timeZone}`];
	const list = transitions(timeZone, from, to);
	if (list.length === 0) {
		const o = offsetString(utcOffsetMinutes(from, timeZone));
		lines.push("BEGIN:STANDARD", "DTSTART:19700101T000000", `TZOFFSETFROM:${o}`, `TZOFFSETTO:${o}`, "END:STANDARD");
	}
	for (const tr of list) {
		const kind = tr.after > tr.before ? "DAYLIGHT" : "STANDARD";
		// DTSTART is the transition's wall-clock time in the offset that was in force before it.
		const d = new Date(tr.at + tr.before * 60_000);
		const wall = localStamp({
			year: d.getUTCFullYear(),
			month: d.getUTCMonth() + 1,
			day: d.getUTCDate(),
			hour: d.getUTCHours(),
			minute: d.getUTCMinutes(),
			second: d.getUTCSeconds(),
		});
		lines.push(
			`BEGIN:${kind}`,
			`DTSTART:${wall}`,
			`TZOFFSETFROM:${offsetString(tr.before)}`,
			`TZOFFSETTO:${offsetString(tr.after)}`,
			`END:${kind}`,
		);
	}
	lines.push("END:VTIMEZONE");
	return lines;
}

function eventLines(e: IcsEvent): string[] {
	if (!(e.end > e.start)) throw new RangeError(`Event ${e.uid}: end must be after start`);
	if (e.timeZone && !isValidTimeZone(e.timeZone)) throw new RangeError(`Invalid time zone: ${e.timeZone}`);
	const lines = ["BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${utcStamp(e.stamp)}`];
	if (e.allDay) {
		lines.push(`DTSTART;VALUE=DATE:${dateStamp(e.start)}`, `DTEND;VALUE=DATE:${dateStamp(e.end)}`);
	} else if (e.timeZone) {
		lines.push(
			`DTSTART;TZID=${e.timeZone}:${localStamp(utcToZoned(e.start, e.timeZone))}`,
			`DTEND;TZID=${e.timeZone}:${localStamp(utcToZoned(e.end, e.timeZone))}`,
		);
	} else {
		lines.push(`DTSTART:${utcStamp(e.start)}`, `DTEND:${utcStamp(e.end)}`);
	}
	if (e.rrule) lines.push(`RRULE:${e.rrule}`);
	lines.push(`SUMMARY:${escapeText(e.summary)}`);
	if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
	if (e.location) lines.push(`LOCATION:${escapeText(e.location)}`);
	if (e.url) lines.push(`URL:${e.url}`);
	if (e.status) lines.push(`STATUS:${e.status}`);
	if (e.sequence !== undefined) lines.push(`SEQUENCE:${e.sequence}`);
	lines.push("END:VEVENT");
	return lines;
}

/** Build a complete VCALENDAR document (CRLF line endings, trailing CRLF). */
export function buildCalendar(cal: IcsCalendar): string {
	const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${cal.prodId}`, "CALSCALE:GREGORIAN"];
	if (cal.method) lines.push(`METHOD:${cal.method}`);
	if (cal.name) lines.push(`X-WR-CALNAME:${escapeText(cal.name)}`);
	const zones = new Map<string, number>();
	for (const e of cal.events) {
		if (e.timeZone && !e.allDay && !zones.has(e.timeZone)) zones.set(e.timeZone, e.start);
	}
	for (const [zone, start] of zones) {
		if (!isValidTimeZone(zone)) throw new RangeError(`Invalid time zone: ${zone}`);
		lines.push(...vtimezone(zone, start));
	}
	for (const e of cal.events) lines.push(...eventLines(e));
	lines.push("END:VCALENDAR");
	return `${lines.map(foldLine).join("\r\n")}\r\n`;
}
