/**
 * Cloudflare Turnstile server-side verification through an injected fetch (one subrequest).
 * The only host contacted is challenges.cloudflare.com.
 */
import { err, ok, type Result } from "./result";

export const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export type TurnstileFetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface TurnstileInput {
	readonly secret: string;
	readonly token: string;
	readonly remoteIp?: string;
}

export async function verifyTurnstile(
	fetchFn: TurnstileFetch,
	input: TurnstileInput,
): Promise<Result<true, "TURNSTILE_FAILED">> {
	if (!input.token) return err("TURNSTILE_FAILED");
	const form = new URLSearchParams({ secret: input.secret, response: input.token });
	if (input.remoteIp) form.set("remoteip", input.remoteIp);
	try {
		const res = await fetchFn(TURNSTILE_VERIFY_URL, { method: "POST", body: form });
		if (!res.ok) return err("TURNSTILE_FAILED");
		const data = (await res.json()) as { success?: unknown };
		return data.success === true ? ok(true) : err("TURNSTILE_FAILED");
	} catch {
		return err("TURNSTILE_FAILED");
	}
}
