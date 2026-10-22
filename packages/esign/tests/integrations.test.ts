import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import {
	deriveClientSecret,
	encodeBase64Url,
	type IntentPayload,
	parsePairing,
	signEsignToken,
} from "@semics-tech/shared";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

import {
	type ClientDoc,
	createClient,
	generateMasterKey,
	listClients,
	parseAllowlist,
	revokeClient,
} from "../src/domain/clients";
import { masterKeyBytes } from "../src/domain/master-key";

// T060 (ES-FR-12, Spike S8): integration clients and pairing strings.

let runtime: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

const MASTER = "master-key-for-tests-0123456789abcdef";
const TARGET = { calls: 8 };
const PAIRING = /esign1\.[A-Za-z0-9_-]{4,64}\.[A-Za-z0-9_-]{43}/;
const text = (res: { blocks?: unknown }) => JSON.stringify(res.blocks);
type Row<T> = { id: string; data: T };

async function setup(withKey = true) {
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost();
	const r = runtime;
	if (withKey) await r.actions.plugin.updateSettings({ integrationMasterKey: MASTER });
	return { r, budget: withBudget(r) };
}

async function create(r: PluginRuntimeTestHost, name = "Events", returnUrlAllowlist = "") {
	const res = await r.admin.submit("/integrations", "client.create", { name, returnUrlAllowlist });
	const pairing = PAIRING.exec(text(res))?.[0];
	return { res, pairing };
}

describe("T060 clients domain", () => {
	it("generated master keys are 32 random bytes that masterKeyBytes accepts", () => {
		const key = generateMasterKey(() => new Uint8Array(32).fill(7));
		expect(key).toBe(encodeBase64Url(new Uint8Array(32).fill(7)));
		expect(masterKeyBytes(key)).not.toBeNull();
		expect(generateMasterKey()).not.toBe(generateMasterKey());
	});

	it("allowlist entries follow protocol section 7", () => {
		expect(parseAllowlist("https://events.example/booking\n\n http://localhost:3000/ ")).toEqual({
			ok: true,
			entries: ["https://events.example/booking", "http://localhost:3000/"],
		});
		for (const bad of [
			"http://events.example/",
			"https://u:p@events.example/",
			"https://events.example/?q=1",
			"https://events.example/#x",
			"/relative",
			"javascript:alert(1)",
		]) {
			expect(parseAllowlist(bad), bad).toEqual({ ok: false, entry: bad });
		}
		expect(parseAllowlist(Array.from({ length: 11 }, (_, i) => `https://e${i}.example/`).join("\n")).ok).toBe(false);
	});

	it("createClient refuses a missing or short key and a blank name, and revoking is once", async () => {
		const docs = new Map<string, ClientDoc>();
		const store = {
			put: async (id: string, d: ClientDoc) => void docs.set(id, d),
			updateIf: async (id: string, a: { where: Record<string, unknown>; set?: Partial<ClientDoc> }) => {
				const d = docs.get(id);
				if (!d || d.revokedAt !== a.where.revokedAt) return { applied: false as const };
				const next = { ...d, ...a.set };
				docs.set(id, next);
				return { applied: true as const, data: next };
			},
			query: async () => ({ items: [...docs].map(([id, data]) => ({ id, data })) }),
		};
		const deps = { now: "2026-10-22T00:00:00.000Z" };
		expect(await createClient(store, { name: "A", returnUrlAllowlist: [], masterKey: "short" }, deps)).toEqual({
			ok: false,
			code: "MASTER_KEY_MISSING",
		});
		expect(await createClient(store, { name: " ", returnUrlAllowlist: [], masterKey: MASTER }, deps)).toEqual({
			ok: false,
			code: "NAME_REQUIRED",
		});
		const made = await createClient(store, { name: "A", returnUrlAllowlist: [], masterKey: MASTER }, deps);
		if (!made.ok) throw new Error("expected ok");
		expect(docs.size).toBe(1);
		expect(JSON.stringify([...docs.values()])).not.toContain(made.pairing.split(".")[2]);
		expect(await revokeClient(store, made.client.clientId, "2026-10-23T00:00:00.000Z")).toBe(true);
		expect(await revokeClient(store, made.client.clientId, "2026-10-24T00:00:00.000Z")).toBe(false);
		expect((await listClients(store))[0]?.revokedAt).toBe("2026-10-23T00:00:00.000Z");
	});
});

describe("T060 Integrations page", () => {
	it("loads and validates in the host, offering to generate a key when none is set", async () => {
		const { r } = await setup(false);
		const res = await r.admin.loadPage("/integrations");
		expect(text(res)).toContain("integrations.generate-key");
	});

	it("generates a master key once, never shows it, and refuses to replace it", async () => {
		const { r, budget } = await setup(false);
		const res = await budget.invokeRoute("admin", { type: "block_action", action_id: "integrations.generate-key" });
		expectWithinBudget(res, TARGET);
		// Stored encrypted (the host keeps only ciphertext); the response never carries a key.
		const stored = JSON.stringify(await r.inspect.setting("integrationMasterKey"));
		expect(stored).toContain("ciphertext");
		expect(JSON.stringify(res.value)).not.toMatch(/[A-Za-z0-9_-]{43}/);
		const again = await r.admin.act("/integrations", "integrations.generate-key");
		expect(text(again)).toContain("Key already set");
		expect(JSON.stringify(await r.inspect.setting("integrationMasterKey"))).toBe(stored);
		// The generated key works: a client can be paired with it.
		expect((await create(r)).pairing).toMatch(PAIRING);
	});

	it("shows the pairing string once; the secret is derived and stored nowhere", async () => {
		const { r, budget } = await setup();
		const res = await budget.invokeRoute("admin", {
			type: "form_submit",
			action_id: "client.create",
			values: { name: "Events", returnUrlAllowlist: "https://events.example/booking" },
		});
		expectWithinBudget(res, TARGET);
		const pairing = PAIRING.exec(JSON.stringify(res.value))?.[0] as string;
		expect(pairing).toBeDefined();
		const parsed = parsePairing(pairing);
		if (!parsed.ok) throw new Error("pairing malformed");
		expect(parsed.value.secret).toEqual(
			await deriveClientSecret(new TextEncoder().encode(MASTER), parsed.value.clientId),
		);

		const rows = (await r.inspect.storage.list("clients")) as Row<ClientDoc>[];
		expect(rows).toHaveLength(1);
		expect(rows[0]?.data).toMatchObject({
			name: "Events",
			clientId: parsed.value.clientId,
			revokedAt: null,
			returnUrlAllowlist: ["https://events.example/booking"],
		});
		const secret = pairing.split(".")[2] as string;
		expect(JSON.stringify(rows)).not.toContain(secret);

		for (const page of ["/integrations", "/settings"]) {
			const again = text(await r.admin.loadPage(page));
			expect(again, page).not.toContain(secret);
			expect(again, page).not.toMatch(PAIRING);
		}
		expect(text(await r.admin.loadPage("/integrations"))).toContain(parsed.value.clientId);
	});

	it("refuses to create a client without a master key or with a bad return URL", async () => {
		const { r } = await setup(false);
		const none = await create(r);
		expect(none.pairing).toBeUndefined();
		expect(text(none.res)).toContain("master key");
		await r.actions.plugin.updateSettings({ integrationMasterKey: MASTER });
		const bad = await create(r, "Events", "http://events.example/");
		expect(bad.pairing).toBeUndefined();
		expect(text(bad.res)).toContain("http://events.example/");
		expect(await r.inspect.storage.list("clients")).toHaveLength(0);
	});

	it("a revoked client is rejected by from-intent, and revoking is idempotent", async () => {
		const { r, budget } = await setup();
		const { pairing } = await create(r);
		const parsed = parsePairing(pairing as string);
		if (!parsed.ok) throw new Error("pairing malformed");
		const { clientId, secret } = parsed.value;
		const now = Math.floor(Date.now() / 1000);
		const intent = async (nonce: string) => {
			const p: IntentPayload = {
				v: 1,
				typ: "intent",
				cid: clientId,
				iat: now,
				exp: now + 600,
				nonce,
				tpl: "missing",
				ref: "BK7Q2M:A1",
				signer: { name: "Ada", email: "ada@example.com" },
				prefill: {},
				returnUrl: "https://events.example/booking/BK7Q2M",
			};
			return (
				await budget.invokeRoute("public/envelopes/from-intent", {
					intent: await signEsignToken("intent", p, secret),
				})
			).value;
		};
		// Accepted far enough to reach the template lookup (the template does not exist).
		expect(await intent("nonce00000000000000001")).not.toMatchObject({
			error: { code: expect.stringMatching(/CLIENT_/) },
		});

		const res = await budget.invokeRoute("admin", {
			type: "block_action",
			action_id: "client.revoke",
			value: clientId,
		});
		expectWithinBudget(res, TARGET);
		const stored = ((await r.inspect.storage.list("clients")) as Row<ClientDoc>[])[0]?.data;
		expect(stored?.revokedAt).toEqual(expect.any(String));
		expect(await intent("nonce00000000000000002")).toMatchObject({ error: { code: "CLIENT_REVOKED" } });

		await r.admin.act("/integrations", "client.revoke", { value: clientId });
		expect(((await r.inspect.storage.list("clients")) as Row<ClientDoc>[])[0]?.data.revokedAt).toBe(stored?.revokedAt);
		expect(text(await r.admin.loadPage("/integrations"))).toContain("Revoked");
	});

	it("the settings page refuses a typed master key shorter than 32 bytes and saves a long one trimmed", async () => {
		const { r } = await setup(false);
		const short = await r.admin.submit("/settings", "settings.save", { integrationMasterKey: "too-short" });
		expect(text(short)).toContain("at least 32");
		expect(await r.inspect.setting("integrationMasterKey")).toBeFalsy();
		await r.admin.submit("/settings", "settings.save", { integrationMasterKey: `  ${MASTER}  ` });
		expect(JSON.stringify(await r.inspect.setting("integrationMasterKey"))).toContain("ciphertext");
		// Trimmed on save: the pairing secret derives from the bare key.
		const parsed = parsePairing((await create(r)).pairing as string);
		if (!parsed.ok) throw new Error("pairing malformed");
		expect(parsed.value.secret).toEqual(
			await deriveClientSecret(new TextEncoder().encode(MASTER), parsed.value.clientId),
		);
	});
});
