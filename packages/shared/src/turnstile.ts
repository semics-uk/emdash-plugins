/**
 * Cloudflare Turnstile server-side verification through an injected fetch (one subrequest).
 * The only host contacted is challenges.cloudflare.com.
 */
import { type ReportLog, report } from "./report";
import { err, ok, type Result } from "./result";

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface TurnstileInput {
	readonly secret: string;
	readonly token: string;
	readonly remoteIp?: string;
	/**
	 * T185 (#79): `ctx.log`. Cloudflare unreachable or failing, and a secret it rejects, refuse every visitor
	 * alike, so the site's log hears of them. A visitor's own bad or stale token is not logged.
	 */
	readonly log?: ReportLog;
}

/** Siteverify's error codes that mean the site's secret is wrong, not the visitor's token. */
const SECRET_PROBLEMS = ["missing-input-secret", "invalid-input-secret"];

export async function verifyTurnstile(
	fetchFn: TurnstileFetch,
	input: TurnstileInput,
): Promise<Result<true, "TURNSTILE_FAILED">> {
	if (!input.token) return err("TURNSTILE_FAILED");
	const form = new URLSearchParams({ secret: input.secret, response: input.token });
	if (input.remoteIp) form.set("remoteip", input.remoteIp);
	try {
		const res = await fetchFn(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
		if (!res.ok) {
			report(input.log, "error", "turnstile.unavailable", { status: res.status });
			return err("TURNSTILE_FAILED");
		}
		const data = (await res.json()) as { success?: unknown; "error-codes"?: unknown };
		if (data.success === true) return ok(true);
		const codes = Array.isArray(data["error-codes"]) ? data["error-codes"] : [];
		const secret = codes.find((c) => SECRET_PROBLEMS.includes(c));
		if (secret) report(input.log, "error", "turnstile.secret_rejected", { reason: secret });
		return err("TURNSTILE_FAILED");
	} catch (e) {
		report(input.log, "error", "turnstile.unavailable", { error: e instanceof Error ? e.name : "unknown" });
		return err("TURNSTILE_FAILED");
	}
}
