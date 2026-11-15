/**
 * One-click pairing of Events with Vouchers on one site (T172), the Vouchers section of `/_events/pair`.
 *
 * The same sandbox facts as `pair.ts` (T145): neither core can reach the other, so this page, running as the
 * signed-in administrator, does it. The host's settings read of Events is the admin check (`plugins:manage`);
 * Vouchers' private `pairing/create` runs in process (a fresh server-side `Request`, no browser headers) and
 * answers the `voucher1.` string once; the host's settings write stores it in Events' `vouchersPairing`
 * (encrypted). The string lives only in this function's memory: never in a response, URL, cookie or log.
 *
 * The state comes from two server-side reads, both after the admin check: Events' stored string (decrypted;
 * only its client id is kept) and Vouchers' active client id (`pairingClientId`, not a secret). A string Events
 * Pro would not parse is reported with a reason (`spaces`, `esign`, `malformed`), never with its value.
 */

import { adminOf, type SettingsHandlers } from "./pair";

const ROUTE = "pairing/create";
const SETTING = "vouchersPairing";
/** Events Pro's parse (`parseVoucherPairing`): exactly as stored, no trimming. */
const PAIRING = /^voucher1\.([A-Za-z0-9_-]{4,64})\.[A-Za-z0-9_-]{43}$/;

export interface VouchersPairIds {
	eventsPluginId: string;
	vouchersPluginId: string;
}

export interface VouchersPairContext {
	locals: unknown;
	url: URL;
	settings: SettingsHandlers;
	/** Events' stored `vouchersPairing`, decrypted on the server (`getPluginSetting`). */
	readPairing: () => Promise<unknown>;
	/** Vouchers' active client id (`getPluginSetting(vouchersPluginId, "pairingClientId")`). */
	readActiveClient: () => Promise<unknown>;
}

export type VouchersPairState =
	| "paired"
	| "unpaired"
	| "stale"
	| "rejected"
	| "vouchers-missing"
	| "forbidden"
	| "error";

export interface VouchersPairView {
	state: VouchersPairState;
	/** The client Events holds (`paired`, `stale`): an id, never the secret. */
	clientId?: string;
	/** Vouchers' active client when it is not the one Events holds (`stale`). */
	activeClientId?: string;
	/** Why Events Pro cannot use the stored string (`rejected`). */
	reason?: "spaces" | "esign" | "malformed";
	/** An error code (never a message that could carry a value). */
	code?: string;
}

const read = (f: () => Promise<unknown>) => f().catch(() => undefined);

/** The page's state for a GET (and the POST's starting point). */
export async function vouchersPairingStatus(ctx: VouchersPairContext, ids: VouchersPairIds): Promise<VouchersPairView> {
	if (!adminOf(ctx.locals)) return { state: "forbidden" };
	const res = await ctx.settings.read(ids.eventsPluginId).catch(() => null);
	if (!res?.ok) return { state: "forbidden" };
	const held = await read(ctx.readPairing);
	if (held === undefined || held === null || held === "") return { state: "unpaired" };
	const text = typeof held === "string" ? held : "";
	const cid = PAIRING.exec(text)?.[1];
	if (!cid) {
		const trimmed = text.trim();
		const reason = PAIRING.test(trimmed) ? "spaces" : trimmed.startsWith("esign1.") ? "esign" : "malformed";
		return { state: "rejected", reason };
	}
	const active = await read(ctx.readActiveClient);
	if (active === cid) return { state: "paired", clientId: cid };
	return typeof active === "string" && active
		? { state: "stale", clientId: cid, activeClientId: active }
		: { state: "stale", clientId: cid };
}

/** The page's POST: pairs unless Events already holds Vouchers' active client (no second client then). */
export async function pairVouchers(ctx: VouchersPairContext, ids: VouchersPairIds): Promise<VouchersPairView> {
	const now = await vouchersPairingStatus(ctx, ids);
	if (now.state === "forbidden") return now;
	if (now.state === "paired") return { state: "paired" };
	const admin = adminOf(ctx.locals);
	if (!admin) return { state: "forbidden" };
	const request = new Request(new URL(`/_emdash/api/plugins/${ids.vouchersPluginId}/${ROUTE}`, ctx.url), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: "{}",
	});
	const res = await admin.call(ids.vouchersPluginId, "POST", ROUTE, request, admin.user).catch(() => null);
	if (!res) return { state: "error", code: "INTERNAL" };
	if (!res.success) {
		const message = typeof res.error?.message === "string" ? res.error.message : "";
		if (res.error?.code === "NOT_FOUND" && /^Plugin not (enabled|found)/.test(message))
			return { state: "vouchers-missing" };
		return { state: "error", code: typeof res.error?.code === "string" ? res.error.code : "INTERNAL" };
	}
	const pairing = (res.data as { ok?: unknown; pairing?: unknown } | undefined)?.pairing;
	if (typeof pairing !== "string" || !PAIRING.test(pairing)) return { state: "error", code: "INTERNAL" };
	const written = await ctx.settings.write(ids.eventsPluginId, { [SETTING]: pairing }).catch(() => null);
	if (written?.ok) return { state: "paired" };
	const body = (await written?.json().catch(() => ({}))) as { error?: { code?: unknown } } | undefined;
	return { state: "error", code: typeof body?.error?.code === "string" ? body.error.code : "INTERNAL" };
}
