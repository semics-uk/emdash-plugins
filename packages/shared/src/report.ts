/**
 * #79 (T185): one way for every plugin to tell the host site something went wrong, through EmDash's own
 * `ctx.log`, so whatever the site already watches (Workers Logs, Sentry on the Worker, `wrangler tail`) shows it.
 * There are no settings, webhook URLs or admin pages. A line carries a stable `code` and a few plain values (ids,
 * counts, statuses). Text values are scrubbed of links, email addresses and long tokens, because a provider's
 * error can echo a message's recipient or link.
 */

/** The part of `ctx.log` this needs. */
export interface ReportLog {
	warn(message: string, data?: unknown): void;
	error(message: string, data?: unknown): void;
}

export type ReportData = Record<string, string | number | boolean | null | undefined>;

/** Links, email addresses and anything token-like (20+ word characters) become "…". */
export const scrubText = (text: string, max = 200) =>
	text.replace(/\S*:\/\/\S*|[^\s@]+@[^\s@]+|[\w-]{20,}/g, "…").slice(0, max);

/** Logs `code` at `level` with `data`; text values scrubbed. A missing log (a unit test's fake ctx) is skipped. */
export function report(log: ReportLog | undefined, level: "warn" | "error", code: string, data: ReportData = {}): void {
	const clean: ReportData = { code };
	for (const [k, v] of Object.entries(data)) clean[k] = typeof v === "string" ? scrubText(v) : v;
	log?.[level](code, clean);
}
