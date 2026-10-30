/**
 * IANA time zone helpers built on `Intl` (no tz database bundled). Instants are epoch milliseconds (UTC);
 * "local" values are wall-clock parts in a named zone.
 */

export interface LocalParts {
	year: number;
	month: number; // 1-12
	day: number;
	hour: number; // 0-23
	minute: number;
	second?: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
	let f = formatters.get(timeZone);
	if (!f) {
		try {
			f = new Intl.DateTimeFormat("en-US", {
				timeZone,
				hourCycle: "h23",
				year: "numeric",
				month: "numeric",
				day: "numeric",
				hour: "numeric",
				minute: "numeric",
				second: "numeric",
			});
		} catch {
			throw new RangeError(`Invalid time zone: ${timeZone}`);
		}
		formatters.set(timeZone, f);
	}
	return f;
}

export function isValidTimeZone(timeZone: string): boolean {
	if (!timeZone) return false;
	try {
		formatter(timeZone);
		return true;
	} catch {
		return false;
	}
}

/** Wall-clock parts of a UTC instant in a zone. */
export function utcToZoned(utcMs: number, timeZone: string): Required<LocalParts> {
	const out: Record<string, number> = {};
	for (const p of formatter(timeZone).formatToParts(new Date(utcMs))) {
		if (p.type !== "literal") out[p.type] = Number(p.value);
	}
	return {
		year: out.year as number,
		month: out.month as number,
		day: out.day as number,
		hour: (out.hour as number) % 24,
		minute: out.minute as number,
		second: out.second as number,
	};
}

/** A number as at least two digits (`7` → `07`). */
export const pad2 = (n: number): string => String(n).padStart(2, "0");

/** A valid IANA zone name, else undefined (callers default it, usually to UTC). */
export const validZone = (timeZone: string | null | undefined): string | undefined =>
	timeZone && isValidTimeZone(timeZone) ? timeZone : undefined;

/** Calendar parts of a UTC instant in UTC (no `Intl`; one copy for ICS, RRULE and schedules, R100). */
export function utcParts(utcMs: number): Required<LocalParts> {
	const d = new Date(utcMs);
	return {
		year: d.getUTCFullYear(),
		month: d.getUTCMonth() + 1,
		day: d.getUTCDate(),
		hour: d.getUTCHours(),
		minute: d.getUTCMinutes(),
		second: d.getUTCSeconds(),
	};
}

/** UTC offset of a zone at an instant, in minutes east of UTC (London summer is 60). */
export function utcOffsetMinutes(utcMs: number, timeZone: string): number {
	const p = utcToZoned(utcMs, timeZone);
	const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
	return Math.round((asUtc - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/**
 * Convert wall-clock parts in a zone to a UTC instant. A repeated local time (clocks going back) resolves
 * to the first occurrence; a skipped local time (clocks going forward) is shifted forward by the gap.
 */
export function zonedToUtc(local: LocalParts, timeZone: string): number {
	const naive = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second ?? 0);
	const offsets = new Set([
		utcOffsetMinutes(naive - 86_400_000, timeZone),
		utcOffsetMinutes(naive + 86_400_000, timeZone),
	]);
	const valid = [...offsets]
		.map((o) => naive - o * 60000)
		.filter((t) => utcOffsetMinutes(t, timeZone) * 60000 === naive - t);
	if (valid.length) return Math.min(...valid);
	// Gap: interpret with the offset in force before the change.
	return naive - utcOffsetMinutes(naive - 86_400_000, timeZone) * 60000;
}

/** Format an instant in a zone with `Intl.DateTimeFormat` options. */
export function formatInZone(
	utcMs: number,
	timeZone: string,
	locale = "en-GB",
	options: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeStyle: "short" },
): string {
	formatter(timeZone);
	return new Intl.DateTimeFormat(locale, { ...options, timeZone }).format(new Date(utcMs));
}

/** ISO 8601 UTC text of epoch milliseconds (default: now). One helper keeps the sandboxed bundles small (R42). */
export const toIso = (ms: number = Date.now()): string => new Date(ms).toISOString();
