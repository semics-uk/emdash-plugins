import { deriveClientSecret, formatPairing, toIso } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";

import { type ClientStore, createClient, generateMasterKey, revokeClient } from "../domain/clients";
import { isEncryptionKeyMissingError } from "../domain/encryption-key";
import { masterKeyBytes } from "../domain/master-key";
import { obj, stores } from "./envelopes";

/**
 * `integrations/pair` (T145): the private route the Events suite calls in process, with the signed-in
 * administrator as the caller, to pair Events on this site without a copy-paste.
 *
 * - `status`: whether the site client exists (`none` / `active` / `revoked`). No secret.
 * - `pair`: generates the master key if none is set, reuses the site client while it is active (the
 *   secret is derived, so the same pairing string comes back: idempotent) or creates one, and returns
 *   the pairing string to the in-process caller, which stores it in Events' own settings.
 * - `unpair`: revokes the site client.
 *
 * The site client's id is kept in KV (`integrations:site-client`); the client itself is an ordinary
 * `clients` row, listed and revocable on the Integrations page. Guards: the caller must be an
 * administrator (role 50), and a request carrying browser headers (`Origin`, `Sec-Fetch-*`) is refused,
 * so a browser can never read a pairing string from here; the host's HTTP dispatch strips nothing of
 * those, while the suite's in-process `Request` has none. Nothing is logged. Bridge calls: status 3,
 * a repeat pair 3, a fresh pair 5, unpair 4.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Headers = { get?: (name: string) => string | null } & Record<string, unknown>;
type Handler = (
	routeCtx: { input?: unknown; request?: { headers?: Headers }; user?: { role?: unknown } | null },
	ctx: PluginContext,
) => Promise<unknown>;

export const SITE_CLIENT_KEY = "integrations:site-client";
const SITE_CLIENT_NAME = "Events on this site";
const ADMIN_ROLE = 50;
const BROWSER_HEADERS = ["origin", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-dest"];

const MESSAGES = {
	ADMIN_REQUIRED: "Only an administrator can pair plugins.",
	SERVER_ONLY: "Pairing runs on the server only.",
	BAD_REQUEST: "The request was not valid.",
	MASTER_KEY_INVALID: "The integration master key is unreadable or shorter than 32 characters.",
	ENCRYPTION_KEY_MISSING: "EMDASH_ENCRYPTION_KEY is not set, so the master key cannot be saved.",
} as const;
type Code = keyof typeof MESSAGES;
const refuse = (code: Code) => ({ ok: false, error: { code, message: MESSAGES[code] } });

function header(headers: Headers | undefined, name: string): unknown {
	if (!headers) return undefined;
	return typeof headers.get === "function" ? (headers.get(name) ?? undefined) : headers[name];
}

/** Set means anything stored, even an envelope the host could not open: never overwrite it. */
const keyIsSet = (v: unknown) => v !== undefined && v !== null && v !== "";

export const PAIR_ROUTES: Record<string, RouteDef> = {
	"integrations/pair": {
		handler: (async (routeCtx, ctx) => {
			const role = routeCtx.user?.role;
			if (typeof role !== "number" || role < ADMIN_ROLE) return refuse("ADMIN_REQUIRED");
			if (BROWSER_HEADERS.some((h) => header(routeCtx.request?.headers, h) !== undefined)) {
				return refuse("SERVER_ONLY");
			}
			const action = obj(routeCtx.input).action;
			if (action !== "status" && action !== "pair" && action !== "unpair") return refuse("BAD_REQUEST");

			const store = stores(ctx).clients as unknown as ClientStore & {
				get(id: string): Promise<{ revokedAt?: string | null } | null>;
			};
			const [entries, savedId] = await Promise.all([ctx.settings.list(), ctx.kv.get<string>(SITE_CLIENT_KEY)]);
			const id = typeof savedId === "string" ? savedId : null;
			const client = id ? await store.get(id) : null;
			const active = client !== null && !client.revokedAt;

			if (action === "status") {
				return client && id
					? { ok: true, client: active ? "active" : "revoked", clientId: id }
					: { ok: true, client: "none" };
			}
			if (action === "unpair") {
				return { ok: true, revoked: active && id ? await revokeClient(store, id, toIso()) : false };
			}

			let key = entries.find((e) => e.key === "integrationMasterKey")?.value;
			if (!keyIsSet(key)) {
				key = generateMasterKey();
				try {
					await ctx.settings.set("integrationMasterKey", key);
				} catch (e) {
					if (isEncryptionKeyMissingError(e)) return refuse("ENCRYPTION_KEY_MISSING");
					throw e;
				}
			}
			const bytes = masterKeyBytes(key);
			if (!bytes) return refuse("MASTER_KEY_INVALID");
			if (active && id) {
				return {
					ok: true,
					created: false,
					clientId: id,
					pairing: formatPairing(id, await deriveClientSecret(bytes, id)),
				};
			}
			const made = await createClient(
				store,
				{ name: SITE_CLIENT_NAME, returnUrlAllowlist: [], masterKey: key },
				{ now: toIso() },
			);
			if (!made.ok) return refuse("MASTER_KEY_INVALID");
			await ctx.kv.set(SITE_CLIENT_KEY, made.client.clientId);
			return { ok: true, created: true, clientId: made.client.clientId, pairing: made.pairing };
		}) as Handler,
	},
};
