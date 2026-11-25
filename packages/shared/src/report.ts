/**
 * #79 (T185): one way for every plugin to tell the host site something went wrong, through EmDash's own
 * `ctx.log`, so whatever the site already watches (Workers Logs, Sentry on the Worker, `wrangler tail`) shows it.
 * There are no settings, webhook URLs or admin pages. A line carries a stable `code` and a few plain values (ids,
 * counts, statuses). Every text value loses links and email addresses; free text from elsewhere (a provider's
 * error, which can echo a recipient, link or token) goes through `scrubText` first, which also drops long tokens.
 */

/**
 * The part of `ctx.log` this needs. In a sandboxed plugin each call is an RPC to the host (EmDash's PluginBridge),
 * so it returns a promise that must be awaited: one left floating is dropped when the invocation ends (rc.36 on
 * lmsc staging: a bad webhook signature never reached the log).
 */
export interface ReportLog {
	warn(message: string, data?: unknown): unknown;
	error(message: string, data?: unknown): unknown;
}

export type ReportData = Record<string, string | number | boolean | null | undefined>;

const LINK_OR_ADDRESS = /\S*:\/\/\S*|[^\s@]+@[^\s@]+/g;

/** For free text: links, email addresses and anything token-like (20+ word characters) become "…". */
export const scrubText = (text: string, max = 200) =>
	text
		.replace(LINK_OR_ADDRESS, "…")
		.replace(/[\w-]{20,}/g, "…")
		.slice(0, max);

/**
 * Logs `code` at `level` with `data`; text values lose links and addresses (ids such as `evt_…` are kept). A
 * missing log or level (a test's fake ctx) is skipped.
 */
export async function report(
	log: ReportLog | undefined,
	level: "warn" | "error",
	code: string,
	data: ReportData = {},
): Promise<void> {
	const clean: ReportData = { code };
	for (const [k, v] of Object.entries(data))
		clean[k] = typeof v === "string" ? v.replace(LINK_OR_ADDRESS, "…").slice(0, 200) : v;
	// Awaited: see ReportLog. A log that fails never fails the caller.
	await Promise.resolve(log?.[level]?.(code, clean)).catch(() => undefined);
}
