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

	// E-sign's model: clients by id, and the site client's id (KV). `clientId` in the input names the
	// client Events' stored pairing uses (T149); without it the site client is meant.
	let siteId: string | null = null;
	const find = (id: string | null | undefined) => esign.clients.find((c) => c.id === id);
	const mint = (id: string) => `esign1.${id}.${"s".repeat(43)}`;
	async function handlePluginApiRoute(pluginId: string, method: string, path: string, request: Request, user: unknown) {
		if (pluginId !== IDS.esignPluginId || !installed) {
			return { success: false, error: { code: "NOT_FOUND", message: `Plugin not enabled: ${pluginId}` } };
		}
		const body = await request.text();
		const input = JSON.parse(body) as { action: string; clientId?: string };
		esign.calls.push({
			method,
			path,
			user,
			action: input.action,
			clientId: input.clientId,
			body,
			origin: request.headers.get("origin"),
			fetchMode: request.headers.get("sec-fetch-mode"),
			cookie: request.headers.get("cookie"),
		});
		const theirs = find(input.clientId ?? siteId);
		const site = find(siteId);
		if (input.action === "status") {
			return {
				success: true,
				data: theirs
					? { ok: true, client: theirs.revoked ? "revoked" : "active", clientId: theirs.id }
					: { ok: true, client: "none" },
			};
		}
		if (input.action === "unpair") {
			const revoked = Boolean(theirs && !theirs.revoked);
			for (const c of [theirs, site]) if (c) c.revoked = true;
			return { success: true, data: { ok: true, revoked } };
		}
		let use = theirs && !theirs.revoked ? theirs : site && !site.revoked ? site : undefined;
		if (use && use !== site && site) site.revoked = true;
		const created = !use;
		if (!use) {
			use = { id: `cl_${esign.clients.length + 1}`, revoked: false };
			esign.clients.push(use);
		}
		siteId = use.id;
		return { success: true, data: { ok: true, created, clientId: use.id, pairing: mint(use.id) } };
	}

	const denied = () => Response.json({ success: false, error: { code: "FORBIDDEN" } }, { status: 403 });
	const ctx: PairContext = {
		locals: {
			user: options.signedIn === false ? undefined : ADMIN,
			emdash: options.signedIn === false ? {} : { handlePluginApiRoute },
		},
		url: new URL("http://site.test/_events/pair"),
		// The host's own decrypting read of Events' setting (server side only).
		readPairing: async () => settings.get("esignPairing"),
		settings: {
			async read(pluginId) {
				if (options.permitted === false) return denied();
				expect(pluginId).toBe(IDS.eventsPluginId);
				return Response.json({
					success: true,
					data: { values: {}, secretsSet: { esignPairing: settings.has("esignPairing") } },
				});
			},
			async write(pluginId, values) {
				if (options.permitted === false) return denied();
				expect(pluginId).toBe(IDS.eventsPluginId);
				if (options.failWrite) {
					return Response.json(
						{ success: false, error: { code: "PLUGIN_SETTING_ENCRYPTION_KEY_MISSING" } },
						{ status: 500 },
					);
				}
				writes.push(values);
				for (const [k, v] of Object.entries(values)) {
					if (v === null) settings.delete(k);
					else settings.set(k, v);
				}
				return Response.json({
					success: true,
					data: { values: {}, secretsSet: { esignPairing: settings.has("esignPairing") } },
				});
			},
		},
	};
	return {
		ctx,
		esign,
		/** An admin made a client on E-sign's Integrations page and pasted its string into Events (T060). */
		handMade(id = "cl_hand") {
			esign.clients.push({ id, revoked: false });
			settings.set("esignPairing", mint(id));
			return id;
		},
		settings,
		writes,
		remove: () => {
			installed = false;
		},
	};
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

	it("T149 a hand-made, active pairing shows as paired, not revoked", async () => {
		const s = site();
		const id = s.handMade();
		expect(await pairingStatus(s.ctx, IDS)).toEqual({ state: "paired" });
		// Only the client id goes to E-sign, never the secret half of the string.
		const call = s.esign.calls.find((c) => c.action === "status");
		expect(call?.clientId).toBe(id);
		expect(String(call?.body)).not.toContain("s".repeat(43));
	});

	it("T149 pairing from a hand-made pairing keeps that one client; nothing is left unused", async () => {
		const s = site();
		const id = s.handMade();
		expect(await pairAction(s.ctx, IDS, "pair")).toEqual({ state: "paired" });
		expect(s.esign.clients).toEqual([{ id, revoked: false }]);
		expect(s.settings.get("esignPairing")).toContain(id);
		// After an earlier auto-pair, the replaced site client is revoked: one active client, the one Events uses.
		const t = site();
		await pairAction(t.ctx, IDS, "pair");
		const hand = t.handMade();
		expect(await pairingStatus(t.ctx, IDS)).toEqual({ state: "paired" });
		await pairAction(t.ctx, IDS, "pair");
		expect(t.esign.clients.filter((c) => !c.revoked).map((c) => c.id)).toEqual([hand]);
	});

	it("T149 a revoked hand-made pairing still shows as revoked; unpair revokes the client Events used", async () => {
		const s = site();
		const id = s.handMade();
		(s.esign.clients[0] as { revoked: boolean }).revoked = true;
		expect(await pairingStatus(s.ctx, IDS)).toEqual({ state: "revoked" });
		expect(await pairAction(s.ctx, IDS, "pair")).toEqual({ state: "paired" });
		expect(s.settings.get("esignPairing")).not.toContain(id);
		const t = site();
		const hand = t.handMade();
		expect(await pairAction(t.ctx, IDS, "unpair")).toEqual({ state: "unpaired" });
		expect(t.esign.calls.find((c) => c.action === "unpair")?.clientId).toBe(hand);
		expect(t.esign.clients[0]?.revoked).toBe(true);
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
