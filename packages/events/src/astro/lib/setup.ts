// i18n-ignore-file: administrators only, in English like the admin it moved from (the setup check, T178).
/**
 * The Events setup check, behind `/_events/setup` (EV-FR-01, S8, T047; moved off the admin page in T178).
 *
 * It ran in the sandboxed admin page; it now runs on the site so the Free backend does not carry it.
 * Facts this rests on (EmDash 1.2):
 * - The host's plugin-settings read (`GET /_emdash/api/admin/plugins/<id>/settings`, run in process with
 *   the visitor's `locals`) checks `plugins:manage`, so it is the administrator check. It answers
 *   `{ schema, values, secretsSet }`: secret settings are masked to `secretsSet[key]` (stored and not
 *   empty), never their values.
 * - The host's schema read (`GET /_emdash/api/schema`) checks `schema:read` and lists every collection
 *   with its fields.
 * - Telling a readable secret from one saved under a lost or changed `EMDASH_ENCRYPTION_KEY` needs a
 *   decrypt: `readSecret` (`getPluginSetting` in the page) throws when the host cannot open the value.
 *   It is called only after the administrator check and only for secrets the host says are set; the
 *   value is dropped here, only "readable" or "unreadable" is kept.
 *
 * Glue only: the rules are `validateMapping` and `encryptionKeyStatus`, the same as the admin page used.
 */

import { encryptionKeyStatus, type SecretReadOutcome } from "./encryption";
import { type EventsMapping, LABELS, validateMapping } from "./mapping";

/** The page (injected by `eventsIntegration`). */
export const SETUP_PATH = "/_events/setup";

export interface SetupContext {
	/** Astro's locals: a visitor with no `user` is refused before anything is read. */
	locals: unknown;
	/** The host's plugin-settings read for the Events core, with the visitor's locals. */
	readSettings(): Promise<Response>;
	/** The host's schema read (`/_emdash/api/schema`), with the visitor's locals. */
	readSchema(): Promise<Response>;
	/** One stored setting of the Events core, decrypted on the server; throws when it cannot be. */
	readSecret(key: string): Promise<unknown>;
}

export interface SetupNotice {
	severity: "error" | "warning";
	title: string;
	message: string;
}

export type SetupView =
	| { state: "forbidden" }
	| { state: "error" }
	| { state: "ok"; notices: SetupNotice[]; fields: Array<{ label: string; value: string }> };

const MAPPING_DEFAULTS: EventsMapping = {
	eventsCollection: "events",
	fieldStartsAt: "starts_at",
	fieldEndsAt: "ends_at",
	fieldTimezone: "timezone",
	fieldVenue: "venue",
};

const NO_TURNSTILE: SetupNotice = {
	severity: "warning",
	title: "Turnstile is not set up",
	message: "Checkout runs without a bot check; add the Turnstile keys.",
};

type Read = { kind: "ok"; data: Record<string, unknown> } | { kind: "forbidden" } | { kind: "error" };

async function read(get: () => Promise<Response>): Promise<Read> {
	// Shown to the admin as an error state; nothing for the site's log.
	const res = await get().catch(() => null);
	if (!res) return { kind: "error" };
	if (res.status === 401 || res.status === 403) return { kind: "forbidden" };
	// Not JSON: shown to the admin as an error state.
	const body = (await res.json().catch(() => null)) as { success?: unknown; data?: unknown } | null;
	const data = body?.data;
	if (!res.ok || body?.success !== true || !data || typeof data !== "object") return { kind: "error" };
	return { kind: "ok", data: data as Record<string, unknown> };
}

const record = (v: unknown): Record<string, unknown> =>
	v && typeof v === "object" ? (v as Record<string, unknown>) : {};

/** Readable when the host opens it to text; anything else it stores but cannot give back is unreadable. */
async function outcome(ctx: SetupContext, key: string, set: unknown): Promise<SecretReadOutcome> {
	if (set !== true) return "unset";
	// Shown to the admin as unreadable; nothing for the site's log.
	const value = await ctx.readSecret(key).catch(() => null);
	return typeof value === "string" && value !== "" ? "readable" : "unreadable";
}

/** The page's state. Nothing is read beyond the settings unless the visitor may manage plugins. */
export async function setupCheck(ctx: SetupContext): Promise<SetupView> {
	// Signed out: refused here, as `/_events/pair` does (without a session the host's handlers can answer 500).
	if (!(ctx.locals as { user?: unknown } | null | undefined)?.user) return { state: "forbidden" };
	const settings = await read(ctx.readSettings);
	if (settings.kind !== "ok") return { state: settings.kind };
	const schema = await read(ctx.readSchema);
	if (schema.kind !== "ok") return { state: schema.kind };

	const values = record(settings.data.values);
	const mapping = { ...MAPPING_DEFAULTS };
	for (const key of Object.keys(mapping) as Array<keyof EventsMapping>) {
		const v = values[key];
		if (typeof v === "string") mapping[key] = v;
	}
	const collections = Array.isArray(schema.data.collections) ? schema.data.collections : [];
	const schemas = Object.fromEntries(
		collections.map((c) => {
			const { slug, fields } = record(c);
			const names = Array.isArray(fields) ? fields.map((f) => String(record(f).slug ?? "")) : [];
			return [String(slug ?? ""), { fields: names }];
		}),
	);
	const mapped = validateMapping(mapping, schemas);

	// Every secret setting the host declares for the core (Pro's too), in the host's own order.
	const set = Object.entries(record(settings.data.secretsSet));
	const secrets: Record<string, SecretReadOutcome> = {};
	for (const [key, isSet] of set) secrets[key] = await outcome(ctx, key, isSet);
	const encryption = encryptionKeyStatus({ secrets });

	const notices: SetupNotice[] = [];
	if (mapped.banner) notices.push(mapped.banner);
	if (encryption.banner) notices.push(encryption.banner);
	if ((secrets.turnstileSecretKey ?? "unset") === "unset") notices.push(NO_TURNSTILE);

	return {
		state: "ok",
		notices,
		fields: (Object.keys(LABELS) as Array<keyof EventsMapping>).map((k) => ({
			label: LABELS[k],
			value: mapping[k] || "(not set)",
		})),
	};
}
