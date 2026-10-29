/** Reply helpers the public routes share (one copy in the bundle, R42). */
import {
	type ErrorCode,
	type ErrorTable,
	EVENTS_ERROR_CODES,
	generateToken,
	ok,
	routeErrorFrom,
	type TurnstileFetch,
	verifyTurnstile,
} from "@semics-tech/shared";
import type { PluginContext } from "emdash/plugin";

import type { InputIssue } from "../domain/checkout";
import { settingsObject } from "../domain/settings";

let errorCodes: ErrorTable = EVENTS_ERROR_CODES;

/**
 * The codes the core answers with: Events' own (R95), so the e-sign and protocol messages stay out
 * of the Free bundle. An edition whose steps answer other codes (Pro receipts: the protocol's) passes
 * `ERROR_CODES` once at load (`src/seams.ts`); a code missing from the table answers `INTERNAL`.
 */
export const useErrorCodes = (table: ErrorTable) => {
	errorCodes = table;
};

/** The route error (status and body) for `code`. */
export const routeError = (code: ErrorCode) => routeErrorFrom(errorCodes, code);

/** The error body for `code`. */
export const fail = (code: ErrorCode) => routeError(code).body;

/** `BAD_REQUEST` with the input issues. */
export const badRequest = (issues: InputIssue[]) => ({ ...fail("BAD_REQUEST"), issues });

/** The host's `fetch`, refused when `network:request` is not granted. */
export const httpFetch =
	(ctx: Pick<PluginContext, "http">): TurnstileFetch =>
	(url, init) => {
		if (!ctx.http) throw new Error("network:request is not granted");
		return ctx.http.fetch(url, init);
	};

/** Settings a public write reads and may write (the IP salt). */
export interface PublicSettings {
	list(): Promise<Array<{ key: string; value: unknown }>>;
	set(key: string, value: unknown): Promise<unknown>;
}

/**
 * A public write's settings as an object and the bot check they imply (checkout reserve, waitlist
 * join): none without a Turnstile secret (the admin page warns), else `siteverify` with the visitor's
 * token and IP, already started. The secret also salts the IP hash; without one the salt is the site's
 * random `ipSalt` setting (undeclared, so never shown), which the first such write stores in the
 * Turnstile call's place (T100, T057 F6: the public plugin id made the hash reversible). `calls` is
 * what `human` costs: 1 at most.
 */
export function botCheck(
	entries: Array<{ key: string; value: unknown }>,
	store: PublicSettings,
	fetch: TurnstileFetch,
	token: string | undefined,
	ip: string | null,
) {
	const settings = settingsObject(entries);
	const secret = typeof settings.turnstileSecretKey === "string" ? settings.turnstileSecretKey : "";
	const stored = typeof settings.ipSalt === "string" ? settings.ipSalt : "";
	const salt = secret || stored || generateToken();
	const human = secret
		? verifyTurnstile(fetch, { secret, token: token ?? "", ...(ip ? { remoteIp: ip } : {}) })
		: (salt === stored ? Promise.resolve() : store.set("ipSalt", salt)).then(() => ok(true as const));
	return { settings, salt, human, calls: +(secret ? !!token : salt !== stored) };
}
