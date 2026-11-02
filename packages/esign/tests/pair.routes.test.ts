import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { deriveClientSecret, parsePairing } from "@semics-tech/shared";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

import type { ClientDoc } from "../src/domain/clients";
import { masterKeyBytes } from "../src/domain/master-key";

// T145: `integrations/pair`, the private route the Events suite calls in process (with the signed-in
// admin as the caller) to pair Events on the same site without a copy-paste.

let runtime: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

const ROUTE = "integrations/pair";
const PAIRING = /esign1\.[A-Za-z0-9_-]{4,64}\.[A-Za-z0-9_-]{43}/;
const ADMIN = { id: "u1", email: "admin@example.com", name: "Admin", role: 50, createdAt: "2026-01-01T00:00:00.000Z" };
const EDITOR = { ...ADMIN, id: "u2", role: 40 };
/** How the suite calls it: the host's in-process dispatch, no browser headers. */
const SERVER = { user: ADMIN, headers: { "content-type": "application/json" } };
type Row<T> = { id: string; data: T };

async function setup(encryption = true) {
	if (encryption) process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	else delete process.env.EMDASH_ENCRYPTION_KEY;
	runtime = await createPluginRuntimeTestHost();
	return { r: runtime, budget: withBudget(runtime) };
}

const clients = async (r: PluginRuntimeTestHost) => (await r.inspect.storage.list("clients")) as Row<ClientDoc>[];

/** A client an admin made by hand on the Integrations page (T060), whose string they pasted into Events. */
async function handMade(r: PluginRuntimeTestHost, name = "Events") {
	await r.transport.invokeRoute("admin", { type: "block_action", action_id: "integrations.generate-key" });
	const res = await r.admin.submit("/integrations", "client.create", { name, returnUrlAllowlist: "" });
	const pairing = PAIRING.exec(JSON.stringify(res))?.[0] as string;
	expect(pairing).toBeDefined();
	const [, clientId, secret] = pairing.split(".") as [string, string, string];
	return { pairing, clientId, secret };
}

describe("T145 integrations/pair (suite auto-pairing)", () => {
	it("T145 pairs a fresh site: generates the master key, creates one client, returns a pairing that verifies", async () => {
		const { r, budget } = await setup();
		const res = await budget.invokeRoute(ROUTE, { action: "pair" }, SERVER);
		expectWithinBudget(res);
		const value = res.value as { ok: boolean; created: boolean; pairing: string; clientId: string };
		expect(value).toMatchObject({ ok: true, created: true });
		expect(value.pairing).toMatch(PAIRING);
		const stored = await r.inspect.setting("integrationMasterKey");
		expect(JSON.stringify(stored)).toContain("ciphertext");
		const rows = await clients(r);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.data).toMatchObject({ clientId: value.clientId, revokedAt: null, returnUrlAllowlist: [] });
		expect(JSON.stringify(rows)).not.toContain(value.pairing.split(".")[2]);
		// No log line carries the pairing string or the secret.
		expect(JSON.stringify(res.calls)).not.toContain(value.pairing.split(".")[2]);
	});

	it("T145 is idempotent: a second pair returns the same client and pairing, no duplicate", async () => {
		const { r, budget } = await setup();
		const first = (await r.transport.invokeRoute(ROUTE, { action: "pair" }, SERVER)) as { pairing: string };
		const again = await budget.invokeRoute(ROUTE, { action: "pair" }, SERVER);
		expectWithinBudget(again);
		expect(again.value).toMatchObject({ ok: true, created: false, pairing: first.pairing });
		expect(await clients(r)).toHaveLength(1);
		const parsed = parsePairing(first.pairing);
		if (!parsed.ok) throw new Error("malformed");
		const status = (await r.transport.invokeRoute(ROUTE, { action: "status" }, SERVER)) as Record<string, unknown>;
		expect(status).toEqual({ ok: true, client: "active", clientId: parsed.value.clientId });
	});

	it("T145 keeps an existing master key and derives the secret from it", async () => {
		const { r } = await setup();
		const MASTER = "master-key-for-tests-0123456789abcdef";
		await r.actions.plugin.updateSettings({ integrationMasterKey: MASTER });
		const res = (await r.transport.invokeRoute(ROUTE, { action: "pair" }, SERVER)) as { pairing: string };
		const parsed = parsePairing(res.pairing);
		if (!parsed.ok) throw new Error("malformed");
		const bytes = masterKeyBytes(MASTER) as Uint8Array;
		expect(parsed.value.secret).toEqual(await deriveClientSecret(bytes, parsed.value.clientId));
	});

	it("T145 unpair revokes the site client; the next pair makes a new one", async () => {
		const { r, budget } = await setup();
		const first = (await r.transport.invokeRoute(ROUTE, { action: "pair" }, SERVER)) as { clientId: string };
		const unpair = await budget.invokeRoute(ROUTE, { action: "unpair" }, SERVER);
		expectWithinBudget(unpair);
		expect(unpair.value).toEqual({ ok: true, revoked: true });
		expect(await r.transport.invokeRoute(ROUTE, { action: "status" }, SERVER)).toEqual({
			ok: true,
			client: "revoked",
			clientId: first.clientId,
		});
		expect(await r.transport.invokeRoute(ROUTE, { action: "unpair" }, SERVER)).toEqual({ ok: true, revoked: false });
		const next = (await r.transport.invokeRoute(ROUTE, { action: "pair" }, SERVER)) as { clientId: string };
		expect(next.clientId).not.toBe(first.clientId);
		expect((await clients(r)).map((c) => c.data.revokedAt === null)).toEqual(expect.arrayContaining([true, false]));
	});

	it("T145 status on a fresh site says no client", async () => {
		const { budget } = await setup();
		const res = await budget.invokeRoute(ROUTE, { action: "status" }, SERVER);
		expectWithinBudget(res);
		expect(res.value).toEqual({ ok: true, client: "none" });
	});

	it("T145 refuses a caller that is not an administrator, and an unknown action", async () => {
		const { r } = await setup();
		for (const user of [undefined, EDITOR]) {
			const res = await r.transport.invokeRoute(ROUTE, { action: "pair" }, { ...SERVER, user });
			expect(res).toMatchObject({ ok: false, error: { code: "ADMIN_REQUIRED" } });
		}
		expect(await r.transport.invokeRoute(ROUTE, { action: "drop" }, SERVER)).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST" },
		});
		expect(await clients(r)).toHaveLength(0);
	});

	it("T145 refuses a browser request: the pairing string never reaches a browser", async () => {
		const { r } = await setup();
		for (const headers of <Array<Record<string, string>>>[
			{ "sec-fetch-mode": "cors" },
			{ "sec-fetch-site": "same-origin" },
			{ origin: "http://localhost" },
		]) {
			const res = await r.transport.invokeRoute(ROUTE, { action: "pair" }, { user: ADMIN, headers });
			expect(res, JSON.stringify(headers)).toMatchObject({ ok: false, error: { code: "SERVER_ONLY" } });
			expect(JSON.stringify(res)).not.toMatch(PAIRING);
		}
		expect(await clients(r)).toHaveLength(0);
	});

	it("T145 refuses to overwrite an unreadable or short master key, and reports a missing encryption key", async () => {
		const { r } = await setup();
		await r.actions.plugin.updateSettings({ integrationMasterKey: "too-short" });
		expect(await r.transport.invokeRoute(ROUTE, { action: "pair" }, SERVER)).toMatchObject({
			ok: false,
			error: { code: "MASTER_KEY_INVALID" },
		});
		await runtime?.dispose();
		const fresh = await setup(false);
		expect(await fresh.r.transport.invokeRoute(ROUTE, { action: "pair" }, SERVER)).toMatchObject({
			ok: false,
			error: { code: "ENCRYPTION_KEY_MISSING" },
		});
		expect(await clients(fresh.r)).toHaveLength(0);
	});

	it("T149 status for Events' own client: a hand-made, active pairing is active (not none)", async () => {
		const { r, budget } = await setup();
		const made = await handMade(r);
		const res = await budget.invokeRoute(ROUTE, { action: "status", clientId: made.clientId }, SERVER);
		expectWithinBudget(res);
		expect(res.value).toEqual({ ok: true, client: "active", clientId: made.clientId });
		expect(JSON.stringify(res.value)).not.toContain(made.secret);
		// An id E-sign does not know is not a working pairing.
		expect(await r.transport.invokeRoute(ROUTE, { action: "status", clientId: "cl_UNKNOWN0000" }, SERVER)).toEqual({
			ok: true,
			client: "none",
		});
	});

	it("T149 pairing from a hand-made pairing adopts that client: no second client, same pairing string", async () => {
		const { r, budget } = await setup();
		const made = await handMade(r);
		const res = await budget.invokeRoute(ROUTE, { action: "pair", clientId: made.clientId }, SERVER);
		expectWithinBudget(res);
		expect(res.value).toMatchObject({ ok: true, created: false, clientId: made.clientId, pairing: made.pairing });
		expect(await clients(r)).toHaveLength(1);
		// It is now the site client: a plain status and a repeat pair find it.
		expect(await r.transport.invokeRoute(ROUTE, { action: "status" }, SERVER)).toEqual({
			ok: true,
			client: "active",
			clientId: made.clientId,
		});
		expect(await r.transport.invokeRoute(ROUTE, { action: "pair" }, SERVER)).toMatchObject({ clientId: made.clientId });
		expect(await clients(r)).toHaveLength(1);
	});

	it("T149 adopting a hand-made client revokes the auto-pair client it replaces: one active client", async () => {
		const { r, budget } = await setup();
		const auto = (await r.transport.invokeRoute(ROUTE, { action: "pair" }, SERVER)) as { clientId: string };
		const made = await handMade(r);
		const res = await budget.invokeRoute(ROUTE, { action: "pair", clientId: made.clientId }, SERVER);
		expectWithinBudget(res);
		expect(res.value).toMatchObject({ clientId: made.clientId, pairing: made.pairing });
		const rows = await clients(r);
		expect(rows.filter((c) => c.data.revokedAt === null).map((c) => c.data.clientId)).toEqual([made.clientId]);
		expect(rows.find((c) => c.data.clientId === auto.clientId)?.data.revokedAt).not.toBeNull();
	});

	it("T149 a revoked hand-made client is replaced by the site client; unpair revokes Events' client", async () => {
		const { r } = await setup();
		const made = await handMade(r);
		await r.admin.act("/integrations", "client.revoke", { value: made.clientId });
		expect(await r.transport.invokeRoute(ROUTE, { action: "status", clientId: made.clientId }, SERVER)).toMatchObject({
			client: "revoked",
		});
		const next = (await r.transport.invokeRoute(ROUTE, { action: "pair", clientId: made.clientId }, SERVER)) as {
			clientId: string;
			created: boolean;
		};
		expect(next).toMatchObject({ created: true });
		expect(next.clientId).not.toBe(made.clientId);
		expect((await clients(r)).filter((c) => c.data.revokedAt === null)).toHaveLength(1);

		const other = await handMade(r, "Events again");
		const unpair = await r.transport.invokeRoute(ROUTE, { action: "unpair", clientId: other.clientId }, SERVER);
		expect(unpair).toEqual({ ok: true, revoked: true });
		// Both the client Events used and the now-unused site client are revoked.
		expect((await clients(r)).filter((c) => c.data.revokedAt === null)).toHaveLength(0);
	});

	it("T149 refuses a malformed client id", async () => {
		const { r } = await setup();
		for (const clientId of ["", "a.b", 7, "x".repeat(65)]) {
			expect(await r.transport.invokeRoute(ROUTE, { action: "status", clientId }, SERVER)).toMatchObject({
				ok: false,
				error: { code: "BAD_REQUEST" },
			});
		}
	});

	it("T145 the Integrations page points to the suite's one-click pairing", async () => {
		const { r } = await setup();
		expect(JSON.stringify((await r.admin.loadPage("/integrations")).blocks)).toContain("/_events/pair");
	});
});
