import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { pairVouchers, type VouchersPairContext, vouchersPairingStatus } from "../src/astro/lib/vouchers-pair";

// T172: the suite pairs Events Pro with Vouchers Pro on the same site, as T145 does for E-sign. The page runs as
// the signed-in admin: the host's settings read is the admin check, Vouchers' private `pairing/create` runs in
// process and answers the pairing string once, and the host's settings write stores it in Events'
// `vouchersPairing`. The fake host below plays Vouchers' route like the real one (a new active client per call).

const IDS = { eventsPluginId: "r_events", vouchersPluginId: "r_vouchers" };
const ADMIN = { id: "u1", email: "admin@example.com", name: "Admin", role: 50, createdAt: "2026-01-01" };
const SECRET = "s".repeat(43);
const mint = (id: string) => `voucher1.${id}.${SECRET}`;

interface Options {
	vouchers?: "installed" | "missing";
	signedIn?: boolean;
	permitted?: boolean;
	failWrite?: boolean;
}

function site(options: Options = {}) {
	const vouchers = { clients: [] as string[], active: undefined as string | undefined, calls: [] as unknown[] };
	const settings = new Map<string, unknown>();
	const writes: Array<{ id: string; values: Record<string, unknown> }> = [];
	const installed = (options.vouchers ?? "installed") === "installed";

	async function handlePluginApiRoute(pluginId: string, method: string, path: string, request: Request, user: unknown) {
		if (pluginId !== IDS.vouchersPluginId || !installed) {
			return { success: false, error: { code: "NOT_FOUND", message: `Plugin not enabled: ${pluginId}` } };
		}
		vouchers.calls.push({
			method,
			path,
			user,
			origin: request.headers.get("origin"),
			fetchMode: request.headers.get("sec-fetch-mode"),
			cookie: request.headers.get("cookie"),
		});
		if (path !== "pairing/create")
			return { success: false, error: { code: "ROUTE_ERROR", message: "Route not found" } };
		const id = `vc_${vouchers.clients.length + 1}`;
		vouchers.clients.push(id);
		vouchers.active = id;
		return { success: true, data: { ok: true, clientId: id, pairing: mint(id) } };
	}

	const denied = () => Response.json({ success: false, error: { code: "FORBIDDEN" } }, { status: 403 });
	const ctx: VouchersPairContext = {
		locals: {
			user: options.signedIn === false ? undefined : ADMIN,
			emdash: options.signedIn === false ? {} : { handlePluginApiRoute },
		},
		url: new URL("http://site.test/_events/pair"),
		// The host's own decrypting read of Events' setting, and Vouchers' active client id (not a secret).
		readPairing: async () => settings.get("vouchersPairing"),
		readActiveClient: async () => vouchers.active,
		settings: {
			async read(pluginId) {
				if (options.permitted === false) return denied();
				expect(pluginId).toBe(IDS.eventsPluginId);
				return Response.json({ success: true, data: { values: {}, secretsSet: {} } });
			},
			async write(pluginId, values) {
				if (options.permitted === false) return denied();
				if (options.failWrite) {
					return Response.json(
						{ success: false, error: { code: "PLUGIN_SETTING_ENCRYPTION_KEY_MISSING" } },
						{ status: 500 },
					);
				}
				writes.push({ id: pluginId, values });
				for (const [k, v] of Object.entries(values)) settings.set(k, v);
				return Response.json({ success: true, data: { values: {}, secretsSet: {} } });
			},
		},
	};
	/** An admin pasted a string into Events' settings by hand. */
	const paste = (value: string) => settings.set("vouchersPairing", value);
	/** An admin made a client on Vouchers' Pairing page (it becomes the active one). */
	const vouchersMade = (id: string) => {
		vouchers.clients.push(id);
		vouchers.active = id;
	};
	return { ctx, vouchers, settings, writes, paste, vouchersMade };
}

describe("T172 one-click Vouchers pairing", () => {
	it("T172 a fresh site reaches paired with one admin action and no copy-paste", async () => {
		const s = site();
		expect(await vouchersPairingStatus(s.ctx, IDS)).toEqual({ state: "unpaired" });
		expect(await pairVouchers(s.ctx, IDS)).toEqual({ state: "paired" });
		// Events holds exactly the string Vouchers answered, written to Events through the host's settings handler.
		expect(s.writes).toEqual([{ id: IDS.eventsPluginId, values: { vouchersPairing: mint("vc_1") } }]);
		expect(await vouchersPairingStatus(s.ctx, IDS)).toEqual({ state: "paired", clientId: "vc_1" });
	});

	it("T172 calls Vouchers in process as the signed-in admin, with no browser headers or cookies", async () => {
		const s = site();
		await pairVouchers(s.ctx, IDS);
		expect(s.vouchers.calls).toEqual([
			{ method: "POST", path: "pairing/create", user: ADMIN, origin: null, fetchMode: null, cookie: null },
		]);
	});

	it("T172 never returns the secret to the page", async () => {
		const s = site();
		const views = [await pairVouchers(s.ctx, IDS), await vouchersPairingStatus(s.ctx, IDS)];
		s.paste(` ${mint("vc_1")}\n`);
		views.push(await vouchersPairingStatus(s.ctx, IDS));
		const failing = site({ failWrite: true });
		views.push(await pairVouchers(failing.ctx, IDS));
		expect(views.at(-1)).toEqual({ state: "error", code: "PLUGIN_SETTING_ENCRYPTION_KEY_MISSING" });
		for (const view of views) expect(JSON.stringify(view)).not.toContain(SECRET);
	});

	it("T172 pairing again while paired changes nothing: no second Vouchers client", async () => {
		const s = site();
		await pairVouchers(s.ctx, IDS);
		expect(await pairVouchers(s.ctx, IDS)).toEqual({ state: "paired" });
		expect(s.vouchers.clients).toEqual(["vc_1"]);
		expect(s.writes).toHaveLength(1);
	});

	it("T172 a working pasted string shows as paired", async () => {
		const s = site();
		s.vouchersMade("vc_hand");
		s.paste(mint("vc_hand"));
		expect(await vouchersPairingStatus(s.ctx, IDS)).toEqual({ state: "paired", clientId: "vc_hand" });
	});

	it("T172 a string for a client that is not Vouchers' active one is stale, and pairing replaces it", async () => {
		const s = site();
		s.vouchersMade("vc_old");
		s.paste(mint("vc_old"));
		// Vouchers' admin pressed "Pair again": a new active client Events does not hold.
		s.vouchersMade("vc_new");
		expect(await vouchersPairingStatus(s.ctx, IDS)).toEqual({
			state: "stale",
			clientId: "vc_old",
			activeClientId: "vc_new",
		});
		expect(await pairVouchers(s.ctx, IDS)).toEqual({ state: "paired" });
		expect(s.settings.get("vouchersPairing")).toBe(mint("vc_3"));
		// Revoked on Vouchers' side (no active client at all): stale too.
		const t = site();
		t.paste(mint("vc_gone"));
		expect(await vouchersPairingStatus(t.ctx, IDS)).toEqual({ state: "stale", clientId: "vc_gone" });
	});

	it("T172 says why a pasted string was rejected, without showing it", async () => {
		const cases: Array<[string, string]> = [
			[` ${mint("vc_1")}\n`, "spaces"],
			[`esign1.cl_1.${SECRET}`, "esign"],
			["voucher1.vc_1.short", "malformed"],
			["paste here", "malformed"],
		];
		for (const [value, reason] of cases) {
			const s = site();
			s.vouchersMade("vc_1");
			s.paste(value);
			expect(await vouchersPairingStatus(s.ctx, IDS)).toEqual({ state: "rejected", reason });
			// Pairing over a rejected string writes a working one.
			expect(await pairVouchers(s.ctx, IDS)).toEqual({ state: "paired" });
			expect(s.settings.get("vouchersPairing")).toBe(mint("vc_2"));
		}
	});

	it("T172 says when Vouchers is not installed or not enabled, and writes nothing", async () => {
		const s = site({ vouchers: "missing" });
		expect(await pairVouchers(s.ctx, IDS)).toEqual({ state: "vouchers-missing" });
		expect(s.writes).toEqual([]);
	});

	it("T172 refuses visitors who are not signed-in administrators before calling Vouchers", async () => {
		for (const options of [{ signedIn: false }, { permitted: false }]) {
			const s = site(options);
			expect(await vouchersPairingStatus(s.ctx, IDS)).toEqual({ state: "forbidden" });
			expect(await pairVouchers(s.ctx, IDS)).toEqual({ state: "forbidden" });
			expect(s.vouchers.calls).toEqual([]);
			expect(s.writes).toEqual([]);
		}
	});

	it("T172 refuses an answer from Vouchers that is not a voucher1 pairing string", async () => {
		const s = site();
		const call = (s.ctx.locals as { emdash: { handlePluginApiRoute: unknown } }).emdash;
		call.handlePluginApiRoute = async () => ({ success: true, data: { ok: true, clientId: "x", pairing: "nope" } });
		expect(await pairVouchers(s.ctx, IDS)).toEqual({ state: "error", code: "INTERNAL" });
		expect(s.writes).toEqual([]);
	});
});

describe("T172 the pages", () => {
	const src = (file: string) => readFileSync(resolve(import.meta.dirname, "../src/astro", file), "utf8");

	it("T172 /_events/pair has a Vouchers section when the suite has Vouchers, with its own form and state", () => {
		const page = src("PairPage.astro");
		expect(page).toContain("vouchersPluginId");
		expect(page).toContain('id="vouchers"');
		expect(page).toContain('data-testid="vouchers-pair"');
		expect(page).toContain('value="vouchers-pair"');
		expect(page).toContain('getPluginSetting(eventsPluginId, "vouchersPairing")');
		expect(page).toContain('"pairingClientId"');
	});

	it("T172 /_vouchers/setup links to the one-click pairing", () => {
		expect(src("VouchersSetupPage.astro")).toContain("/_events/pair#vouchers");
	});
});
