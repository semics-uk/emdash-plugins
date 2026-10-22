/** Reply helpers the public routes share (one copy in the bundle, R42). */
import { type ErrorCode, ok, type TurnstileFetch, toRouteError, verifyTurnstile } from "@semics-tech/shared";
import type { PluginContext } from "emdash/plugin";

import type { InputIssue } from "../domain/checkout";

/** The error body for `code`. */
export const fail = (code: ErrorCode) => toRouteError(code).body;

/** `BAD_REQUEST` with the input issues. */
export const badRequest = (issues: InputIssue[]) => ({ ...fail("BAD_REQUEST"), issues });

/** The host's `fetch`, refused when `network:request` is not granted. */
export const httpFetch =
	(ctx: Pick<PluginContext, "http">): TurnstileFetch =>
	(url, init) => {
		if (!ctx.http) throw new Error("network:request is not granted");
		return ctx.http.fetch(url, init);
	};

/**
 * A public write's settings as an object and the bot check they imply (checkout reserve, waitlist
 * join): none without a Turnstile secret (the admin page warns), else `siteverify` with the visitor's
 * token and IP, already started. The secret also salts the IP hash (the plugin id without one).
 */
export function botCheck(
	entries: Array<{ key: string; value: unknown }>,
	fetch: TurnstileFetch,
	token: string | undefined,
	ip: string | null,
) {
	const settings = Object.fromEntries(entries.map((e) => [e.key, e.value]));
	const secret = typeof settings.turnstileSecretKey === "string" ? settings.turnstileSecretKey : "";
	const human = secret
		? verifyTurnstile(fetch, { secret, token: token ?? "", ...(ip ? { remoteIp: ip } : {}) })
		: Promise.resolve(ok(true as const));
	return { settings, secret, human };
}
