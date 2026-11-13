// Shared steps of the gift voucher e2e spec (T168). They run only when the playground is built with Events Pro
// and Vouchers Pro (`EMDASH_PRO_DIR=<Pro checkout>` with both built; staging/link-pro.mjs links Vouchers when it is
// built) and skip on the Free build every other spec expects. Vouchers' settings are saved as its settings page does;
// pairing is the Pairing page's `pairing/create`, pasted into Events as an operator would.
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, expect, test } from "@playwright/test";

import { admin, saveSettings } from "./pro";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const VOUCHERS = "/_emdash/api/plugins/semics-vouchers";
export const CODE = /[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/;

let linked: boolean | undefined;
/** Whether the site runs Vouchers Pro: its private `pro/licence` route answers. */
export async function hasVouchers(request: APIRequestContext): Promise<boolean> {
	if (linked === undefined) {
		const res = await request.get(`${VOUCHERS}/pro/licence`, { headers: admin });
		linked = res.ok();
	}
	return linked;
}

/** Skips the calling test unless the site runs Events Pro and Vouchers Pro. */
export async function requireVouchers(request: APIRequestContext) {
	test.skip(!(await hasVouchers(request)), "Vouchers Pro is not linked (build both with EMDASH_PRO_DIR=<Pro checkout>)");
}

/** Saves Vouchers settings as its settings page does. */
export async function saveVoucherSettings(request: APIRequestContext, values: Record<string, unknown>) {
	const res = await request.put("/_emdash/api/admin/plugins/semics-vouchers/settings", { data: { values }, headers: admin });
	expect(res.ok(), await res.text()).toBe(true);
}

/** Vouchers' Pairing page, then the string pasted into Events' `vouchersPairing` setting. */
export async function pairVouchers(request: APIRequestContext) {
	const res = await request.post(`${VOUCHERS}/pairing/create`, { data: {}, headers: admin });
	const reply = (await res.json()) as { data?: { pairing?: string } };
	expect(reply.data?.pairing, JSON.stringify(reply)).toMatch(/^voucher1\./);
	await saveSettings(request, { vouchersPairing: reply.data?.pairing });
}

export interface VoucherState {
	balanceMinor: number;
	heldMinor: number;
	usesLeft: number;
	status: string;
}

/** What the voucher page reads (public/redeem/check, no booking). */
export async function voucherState(request: APIRequestContext, code: string): Promise<VoucherState> {
	const res = await request.post(`${VOUCHERS}/public/redeem/check`, {
		data: { code },
		headers: { "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 250) + 1}` },
	});
	const reply = (await res.json()) as { data?: { ok?: boolean; voucher?: VoucherState } };
	expect(reply.data?.ok, JSON.stringify(reply)).toBe(true);
	return reply.data?.voucher as VoucherState;
}

function db<T>(fn: (d: DatabaseSync) => T): T {
	const d = new DatabaseSync(resolve(root, "data.db"));
	try {
		return fn(d);
	} finally {
		d.close();
	}
}

/**
 * Moves every open hold of the voucher with this code's last four characters past its window (`exp`), as half an
 * hour passing would: Vouchers keeps an abandoned hold until then (voucher/1 §5.2).
 */
export function lapseHolds(last4: string) {
	db((d) => {
		const past = Math.floor(Date.now() / 1000) - 3600;
		const rows = d
			.prepare(
				`SELECT id, data FROM _plugin_storage WHERE plugin_id = 'semics-vouchers' AND collection = 'vouchers' AND json_extract(data, '$.last4') = ?`,
			)
			.all(last4) as Array<{ id: string; data: string }>;
		for (const row of rows) {
			const v = JSON.parse(row.data) as { holds: Array<{ rid: string; iat: number; exp: number }> };
			for (const h of v.holds) {
				h.iat = past - 1800;
				h.exp = past;
				const r = d
					.prepare(`SELECT data FROM _plugin_storage WHERE plugin_id = 'semics-vouchers' AND collection = 'redemptions' AND id = ?`)
					.get(h.rid) as { data: string } | undefined;
				if (r) {
					d.prepare(
						`UPDATE _plugin_storage SET data = ? WHERE plugin_id = 'semics-vouchers' AND collection = 'redemptions' AND id = ?`,
					).run(JSON.stringify({ ...JSON.parse(r.data), iat: past - 1800, exp: past }), h.rid);
				}
			}
			d.prepare(`UPDATE _plugin_storage SET data = ? WHERE plugin_id = 'semics-vouchers' AND collection = 'vouchers' AND id = ?`).run(
				JSON.stringify(v),
				row.id,
			);
		}
	});
}

/** The redemptions (holds) of a booking ref, as Vouchers keeps them. */
export function redemptionsOf(ref: string): Array<Record<string, unknown>> {
	const rows = db((d) =>
		d
			.prepare(
				`SELECT data FROM _plugin_storage WHERE plugin_id = 'semics-vouchers' AND collection = 'redemptions' AND json_extract(data, '$.ref') = ?`,
			)
			.all(ref),
	) as Array<{ data: string }>;
	return rows.map((r) => JSON.parse(r.data));
}
