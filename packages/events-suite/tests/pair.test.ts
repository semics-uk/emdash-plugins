import { describe, expect, it } from "vitest";

import { type PairContext, pairAction, pairingStatus } from "../src/astro/lib/pair";
import { eventsSuite } from "../src/index";

// T145: the suite pairs Events with E-sign on the same site. The page logic runs against a fake host:
// `handlePluginApiRoute` answers E-sign's private `integrations/pair` like the real route (one site
// client, derived secret), and the settings handlers play the host's own plugin-settings API, which
// keeps secrets write-only (`secretsSet`).

const IDS = { eventsPluginId: "r_events", esignPluginId: "r_esign" };
const ADMIN = { id: "u1", email: "admin@example.com", name: "Admin", role: 50, createdAt: "2026-01-01" };
const PAIRING_RE = /esign1\./;

interface Options {
	esign?: "installed" | "missing";
	signedIn?: boolean;
	permitted?: boolean;
	failWrite?: boolean;
}

function site(options: Options = {}) {
	const esign = { clients: [] as Array<{ id: string; revoked: boolean }>, calls: [] as Array<Record<string, unknown>> };
	const settings = new Map<string, unknown>();
	const writes: Array<Record<string, unknown>> = [];
	let installed = (options.esign ?? "installed") === "installed";

	async function handlePluginApiRoute(pluginId: string, method: string, path: string, request: Request, user: unknown) {
		if (pluginId !== IDS.esignPluginId || !installed) {
			return { success: false, error: { code: "NOT_FOUND", message: `Plugin not enabled: ${pluginId}` } };
		}
		const input = (await request.json()) as { action: string };
		esign.calls.push({
			method,
			path,
			user,
			action: input.action,
			origin: request.headers.get("origin"),
			fetchMode: request.headers.get("sec-fetch-mode"),
			cookie: request.headers.get("cookie"),
		});
		const current = esign.clients.at(-1);
		const active = current && !current.revoked;
		if (input.action === "status") {
			return { success: true, data: current ? { ok: true, client: active ? "active" : "revoked", clientId: current.id } : { ok: true, client: "none" } };
		}
		if (input.action === "unpair") {
			if (active) current.revoked = true;
			return { success: true, data: { ok: true, revoked: Boolean(active) } };
		}
		if (!active) esign.clients.push({ id: `cl_${esign.clients.length + 1}`, revoked: false });
		const id = esign.clients.at(-1)?.id as string;
		return { success: true, data: { ok: true, created: !active, clientId: id, pairing: `esign1.${id}.${"s".repeat(43)}` } };
	}

	const denied = () => Response.json({ success: false, error: { code: "FORBIDDEN" } }, { status: 403 });
	const ctx: PairContext = {
		locals: {
			user: options.signedIn === false ? undefined : ADMIN,
			emdash: options.signedIn === false ? {} : { handlePluginApiRoute },
		},
		url: new URL("http://site.test/_events/pair"),
		settings: {
			async read(pluginId) {
				if (options.permitted === false) return denied();
				expect(pluginId).toBe(IDS.eventsPluginId);
				return Response.json({ success: true, data: { values: {}, secretsSet: { esignPairing: settings.has("esignPairing") } } });
			},
			async write(pluginId, values) {
				if (options.permitted === false) return denied();
				expect(pluginId).toBe(IDS.eventsPluginId);
				if (options.failWrite) {
					return Response.json({ success: false, error: { code: "PLUGIN_SETTING_ENCRYPTION_KEY_MISSING" } }, { status: 500 });
				}
				writes.push(values);
				for (const [k, v] of Object.entries(values)) {
					if (v === null) settings.delete(k);
					else settings.set(k, v);
				}
				return Response.json({ success: true, data: { values: {}, secretsSet: { esignPairing: settings.has("esignPairing") } } });
			},
		},
	};
	return { ctx, esign, settings, writes, remove: () => void (installed = false) };
}

describe("T145 suite auto-pairing", () => {
	it("T145 a fresh site reaches paired with one admin action and no copy-paste", async () => {
		const s = site();
		expect(await pairingStatus(s.ctx, IDS)).toEqual({ state: "unpaired" });
		const view = await pairAction(s.ctx, IDS, "pair");
		expect(view).toEqual({ state: "paired" });
		// Events holds exactly the pairing string E-sign derived, written through the host's settings API.
		expect(s.settings.get("esignPairing")).toBe(`esign1.cl_1.${"s".repeat(43)}`);
		expect(await pairingStatus(s.ctx, IDS)).toEqual({ state: "paired" });
	});

	it("T145 calls E-sign in process as the signed-in admin, with no browser headers or cookies", async () => {
		const s = site();
		await pairAction(s.ctx, IDS, "pair");
		const pair = s.esign.calls.find((c) => c.action === "pair");
		expect(pair).toMatchObject({ method: "POST", path: "integrations/pair", user: ADMIN });
		expect(pair).toMatchObject({ origin: null, fetchMode: null, cookie: null });
	});

	it("T145 never returns the secret to the page", async () => {
		const s = site();
		for (const view of [await pairAction(s.ctx, IDS, "pair"), await pairingStatus(s.ctx, IDS)]) {
			expect(JSON.stringify(view)).not.toMatch(PAIRING_RE);
		}
		const failing = site({ failWrite: true });
		const view = await pairAction(failing.ctx, IDS, "pair");
		expect(view).toEqual({ state: "error", code: "PLUGIN_SETTING_ENCRYPTION_KEY_MISSING" });
		expect(JSON.stringify(view)).not.toMatch(PAIRING_RE);
	});

	it("T145 re-running pairing is idempotent: one E-sign client, the same pairing", async () => {
		const s = site();
		await pairAction(s.ctx, IDS, "pair");
		await pairAction(s.ctx, IDS, "pair");
		expect(s.esign.clients).toHaveLength(1);
		expect(new Set(s.writes.map((w) => w.esignPairing)).size).toBe(1);
	});

	it("T145 unpairing revokes the client and leaves Events in the pairing state", async () => {
		const s = site();
		await pairAction(s.ctx, IDS, "pair");
		expect(await pairAction(s.ctx, IDS, "unpair")).toEqual({ state: "unpaired" });
		expect(s.settings.has("esignPairing")).toBe(false);
		expect(s.esign.clients[0]?.revoked).toBe(true);
		expect(await pairingStatus(s.ctx, IDS)).toEqual({ state: "unpaired" });
	});

	it("T145 removing E-sign clears the stale pairing when the admin opens the page", async () => {
		const s = site();
		await pairAction(s.ctx, IDS, "pair");
		s.remove();
		expect(await pairingStatus(s.ctx, IDS)).toEqual({ state: "esign-missing", cleared: true });
		expect(s.settings.has("esignPairing")).toBe(false);
		expect(await pairingStatus(s.ctx, IDS)).toEqual({ state: "esign-missing" });
		expect(await pairAction(s.ctx, IDS, "pair")).toEqual({ state: "esign-missing" });
		expect(s.settings.has("esignPairing")).toBe(false);
		// Unpairing still works without E-sign.
		expect(await pairAction(s.ctx, IDS, "unpair")).toEqual({ state: "unpaired" });
	});

	it("T145 a pairing E-sign revoked shows as revoked, and pairing again replaces it", async () => {
		const s = site();
		await pairAction(s.ctx, IDS, "pair");
		(s.esign.clients[0] as { revoked: boolean }).revoked = true;
		expect(await pairingStatus(s.ctx, IDS)).toEqual({ state: "revoked" });
		expect(await pairAction(s.ctx, IDS, "pair")).toEqual({ state: "paired" });
		expect(s.settings.get("esignPairing")).toContain("cl_2");
	});

	it("T145 refuses visitors who are not signed-in administrators before calling E-sign", async () => {
		for (const options of [{ signedIn: false }, { permitted: false }]) {
			const s = site(options);
			expect(await pairingStatus(s.ctx, IDS)).toEqual({ state: "forbidden" });
			expect(await pairAction(s.ctx, IDS, "pair")).toEqual({ state: "forbidden" });
			expect(s.esign.calls).toEqual([]);
			expect(s.settings.size).toBe(0);
		}
	});

	it("T145 refuses an unknown action", async () => {
		const s = site();
		expect(await pairAction(s.ctx, IDS, "drop")).toEqual({ state: "error", code: "BAD_REQUEST" });
		expect(s.esign.calls).toEqual([]);
	});

	it("T145 the suite injects /_events/pair", () => {
		const routes: Array<{ pattern: string; entrypoint: string }> = [];
		for (const integration of eventsSuite().integrations) {
			integration.hooks["astro:config:setup"]({
				injectRoute: (r) => routes.push(r),
				updateConfig: () => {},
			});
		}
		expect(routes.find((r) => r.pattern === "/_events/pair")?.entrypoint).toBe(
			"@semics-tech/emdash-events-suite/astro/PairPage.astro",
		);
	});
});
