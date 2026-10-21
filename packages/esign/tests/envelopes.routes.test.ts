import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import {
	canonicalSnapshot,
	deriveClientSecret,
	hashToken,
	type IntentPayload,
	renderTemplate,
	sha256Hex,
	signEsignToken,
} from "@semics-tech/shared";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

/** R22: designs target ≤ 8 bridge calls so a later log or email call never tips a route over 10. */
const TARGET = { calls: 8, cpuMs: 50 };

let runtime: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

const MASTER = "master-key-for-tests-0123456789abcdef";
const CID = "cl_testclient01";
const BODY = "I, {{signer.name}}, accept the {{event}} terms.\n";

type Body = Record<string, unknown> & { ok: boolean; error?: { code: string } };

async function setup(): Promise<BudgetedHost> {
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost();
	return withBudget(runtime);
}

async function createTemplate(budget: BudgetedHost, body = BODY): Promise<string> {
	const r = (await budget.invokeRoute("templates/create", { name: "Waiver", body })).value as {
		template: { id: string };
	};
	return r.template.id;
}

async function call(budget: BudgetedHost, route: string, input: unknown): Promise<Body> {
	const r = await budget.invokeRoute(route, input);
	expectWithinBudget(r, TARGET);
	return r.value as Body;
}

async function storageText(): Promise<string> {
	const all = await Promise.all(
		["envelopes", "signers", "snapshots", "nonces", "audit_events"].map((c) => runtime?.inspect.storage.list(c)),
	);
	return JSON.stringify(all);
}

describe("ES-FR-02 private envelope routes", () => {
	it("ES-FR-02 create then send freezes the snapshot and docSha256 matches the canonical snapshot", async () => {
		const budget = await setup();
		const templateId = await createTemplate(budget);
		const created = await call(budget, "envelopes/create", {
			templateId,
			signer: { name: "Ada Lovelace", email: "ada@example.com" },
			fields: { event: "Rock & <Roll>" },
		});
		expect(created).toMatchObject({ ok: true, envelope: { status: "draft", templateVersion: 1, docSha256: null } });
		const id = (created.envelope as { id: string }).id;

		const sent = await call(budget, "envelopes/send", { id });
		expect(sent).toMatchObject({ ok: true, envelope: { id, status: "sent" } });
		expect(JSON.stringify(sent)).not.toContain("tokenHash");

		const got = await call(budget, "envelopes/get", { id });
		const expected = canonicalSnapshot(renderTemplate(BODY, { "signer.name": "Ada Lovelace", event: "Rock & <Roll>" }));
		expect(got).toMatchObject({ ok: true, snapshot: expected, envelope: { docSha256: await sha256Hex(expected) } });
		expect(got.signers).toEqual([
			{ id: `${id}:s1`, order: 1, name: "Ada Lovelace", email: "ada@example.com", status: "pending" },
		]);

		const signers = (await runtime?.inspect.storage.list<{ tokenHash: string }>("signers")) ?? [];
		expect(signers).toHaveLength(1);
		expect(signers[0]?.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
		expect(Object.keys(signers[0]?.data ?? {})).not.toContain("token");
	});

	it("ES-FR-02 snapshot is immutable after send: template edits and a second send change nothing", async () => {
		const budget = await setup();
		const templateId = await createTemplate(budget);
		const created = await call(budget, "envelopes/create", {
			templateId,
			signer: { name: "Ada", email: "ada@example.com" },
			fields: { event: "Gig" },
		});
		const id = (created.envelope as { id: string }).id;
		await call(budget, "envelopes/send", { id });
		const before = await call(budget, "envelopes/get", { id });
		const chunksBefore = await runtime?.inspect.storage.list("snapshots");

		await budget.invokeRoute("templates/update", { id: templateId, name: "Waiver", body: "Totally new {{event}}" });
		const again = await call(budget, "envelopes/send", { id });
		expect(again).toMatchObject({ ok: false, error: { code: "ENVELOPE_CLOSED" } });

		const after = await call(budget, "envelopes/get", { id });
		expect(after.snapshot).toBe(before.snapshot);
		expect((after.envelope as { docSha256: string }).docSha256).toBe(
			(before.envelope as { docSha256: string }).docSha256,
		);
		expect(await runtime?.inspect.storage.list("snapshots")).toEqual(chunksBefore);
		expect(await runtime?.inspect.storage.list("signers")).toHaveLength(1);
	});

	it("ES-FR-02 rejects bad input, missing fields, archived templates and unknown envelopes", async () => {
		const budget = await setup();
		const templateId = await createTemplate(budget);
		expect(await call(budget, "envelopes/create", { templateId, signer: { name: "", email: "x" } })).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST" },
		});
		expect(
			await call(budget, "envelopes/create", { templateId, signer: { name: "A", email: "a@example.com" } }),
		).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" }, issues: [{ path: "fields.event" }] });
		expect(
			await call(budget, "envelopes/create", {
				templateId,
				templateVersion: 7,
				signer: { name: "A", email: "a@example.com" },
				fields: { event: "x" },
			}),
		).toMatchObject({ ok: false, error: { code: "TEMPLATE_NOT_FOUND" } });
		await budget.invokeRoute("templates/archive", { id: templateId });
		expect(
			await call(budget, "envelopes/create", {
				templateId,
				signer: { name: "A", email: "a@example.com" },
				fields: { event: "x" },
			}),
		).toMatchObject({ ok: false, error: { code: "TEMPLATE_NOT_FOUND" } });
		for (const route of ["envelopes/send", "envelopes/get"]) {
			expect(await call(budget, route, { id: "missing" })).toMatchObject({ error: { code: "ENVELOPE_NOT_FOUND" } });
			expect(await call(budget, route, {})).toMatchObject({ error: { code: "BAD_REQUEST" } });
		}
		expect(await call(budget, "envelopes/list", { status: "weird" })).toMatchObject({ error: { code: "BAD_REQUEST" } });
	});

	it("ES-FR-03 lists envelopes by status without snapshots or signer secrets", async () => {
		const budget = await setup();
		const templateId = await createTemplate(budget, "Hello {{signer.name}}");
		const a = await call(budget, "envelopes/create", { templateId, signer: { name: "A", email: "a@example.com" } });
		await call(budget, "envelopes/create", { templateId, signer: { name: "B", email: "b@example.com" } });
		await call(budget, "envelopes/send", { id: (a.envelope as { id: string }).id });
		const drafts = await call(budget, "envelopes/list", { status: "draft" });
		expect((drafts.envelopes as Array<{ signer: { name: string } }>).map((e) => e.signer.name)).toEqual(["B"]);
		const all = await call(budget, "envelopes/list", {});
		expect(all.envelopes).toHaveLength(2);
		expect(JSON.stringify(all)).not.toContain("tokenHash");
	});

	it("rejects unauthenticated calls to every private envelope route (runtime host)", async () => {
		await setup();
		for (const name of ["create", "send", "get", "list"]) {
			const res = await runtime?.actions.routes.request(`envelopes/${name}`, { method: "POST", body: {} });
			expect([401, 403]).toContain(res?.status);
		}
	});
});

// --- public/envelopes/from-intent ---

const NOW_S = () => Math.floor(Date.now() / 1000);
let nonceSeq = 0;

function payload(templateId: string, over: Partial<IntentPayload> = {}): IntentPayload {
	nonceSeq++;
	return {
		v: 1,
		typ: "intent",
		cid: CID,
		iat: NOW_S(),
		exp: NOW_S() + 600,
		nonce: `nonce${String(nonceSeq).padStart(17, "0")}`,
		tpl: templateId,
		ref: "BK7Q2M:A1",
		signer: { name: "Ada Lovelace", email: "ada@example.com" },
		prefill: { event: "Gig" },
		returnUrl: "https://events.example/booking/BK7Q2M",
		...over,
	};
}

async function sign(p: IntentPayload, master = MASTER): Promise<string> {
	return signEsignToken("intent", p, await deriveClientSecret(new TextEncoder().encode(master), p.cid));
}

async function setupIntegration(client: Record<string, unknown> = {}) {
	const budget = await setup();
	const saved = await runtime?.actions.plugin.updateSettings({ integrationMasterKey: MASTER, expiryDays: 14 });
	expect(saved?.success, JSON.stringify(saved)).toBe(true);
	await runtime?.fixtures.plugin.storage("clients", CID, {
		name: "Events",
		clientId: CID,
		createdAt: "2026-10-01T00:00:00.000Z",
		revokedAt: null,
		returnUrlAllowlist: ["https://events.example/booking"],
		...client,
	});
	const templateId = await createTemplate(budget);
	return { budget, templateId };
}

describe("ES-FR-02 public/envelopes/from-intent", () => {
	it("ES-FR-02 creates a sent envelope, returns the signing token once and stores only its hash", async () => {
		const { budget, templateId } = await setupIntegration();
		const r = await call(budget, "public/envelopes/from-intent", { intent: await sign(payload(templateId)) });
		expect(Object.keys(r).sort()).toEqual(["envelopeId", "ok", "signingToken", "status"]);
		expect(r).toMatchObject({ ok: true, status: "sent" });
		const token = r.signingToken as string;
		const signers = (await runtime?.inspect.storage.list<{ tokenHash: string }>("signers")) ?? [];
		expect(signers.map((s) => s.data.tokenHash)).toEqual([await hashToken(token)]);
		expect(await storageText()).not.toContain(token);

		const envelope = await runtime?.inspect.storage.get<Record<string, unknown>>("envelopes", r.envelopeId as string);
		const expected = canonicalSnapshot(renderTemplate(BODY, { "signer.name": "Ada Lovelace", event: "Gig" }));
		expect(envelope).toMatchObject({
			status: "sent",
			clientId: CID,
			externalRef: "BK7Q2M:A1",
			delivery: "inline",
			docSha256: await sha256Hex(expected),
		});
		const sentAt = Date.parse(envelope?.sentAt as string);
		expect(Date.parse(envelope?.expiresAt as string) - sentAt).toBe(14 * 86_400_000);
	});

	it("ES-FR-02 a replayed intent is rejected; a new intent for the same ref returns the same envelope", async () => {
		const { budget, templateId } = await setupIntegration();
		const token = await sign(payload(templateId));
		const first = await call(budget, "public/envelopes/from-intent", { intent: token });
		expect(await call(budget, "public/envelopes/from-intent", { intent: token })).toMatchObject({
			ok: false,
			error: { code: "TOKEN_REPLAYED" },
		});
		const second = await call(budget, "public/envelopes/from-intent", {
			intent: await sign(payload(templateId, { prefill: { event: "Other" } })),
		});
		expect(second).toMatchObject({ ok: true, envelopeId: first.envelopeId, status: "sent" });
		expect(second.signingToken).not.toBe(first.signingToken);
		const signers = (await runtime?.inspect.storage.list<{ tokenHash: string }>("signers")) ?? [];
		expect(signers.map((s) => s.data.tokenHash)).toEqual([await hashToken(second.signingToken as string)]);
		expect(await runtime?.inspect.storage.list("envelopes")).toHaveLength(1);
	});

	it("ES-FR-03 a declined envelope for the ref gets a new envelope", async () => {
		const { budget, templateId } = await setupIntegration();
		const first = await call(budget, "public/envelopes/from-intent", { intent: await sign(payload(templateId)) });
		const stored = await runtime?.inspect.storage.get<Record<string, unknown>>("envelopes", first.envelopeId as string);
		await runtime?.fixtures.plugin.storage("envelopes", first.envelopeId as string, { ...stored, status: "declined" });
		const next = await call(budget, "public/envelopes/from-intent", { intent: await sign(payload(templateId)) });
		expect(next).toMatchObject({ ok: true, status: "sent" });
		expect(next.envelopeId).not.toBe(first.envelopeId);
		expect(await runtime?.inspect.storage.list("envelopes")).toHaveLength(2);
	});

	it("ES-FR-02 email delivery returns no signing token", async () => {
		const { budget, templateId } = await setupIntegration();
		const r = await call(budget, "public/envelopes/from-intent", {
			intent: await sign(payload(templateId, { delivery: "email" })),
		});
		expect(r).toMatchObject({ ok: true, status: "sent" });
		expect(r.signingToken).toBeUndefined();
	});

	it("ES-FR-02 rejects bad, unknown-client, revoked, off-allowlist and wrong-key intents", async () => {
		const { budget, templateId } = await setupIntegration();
		const cases: Array<[unknown, string]> = [
			[{}, "TOKEN_MALFORMED"],
			[{ intent: "nope" }, "TOKEN_MALFORMED"],
			[{ intent: await sign(payload(templateId, { cid: "cl_unknown01" })) }, "CLIENT_UNKNOWN"],
			[{ intent: await sign(payload(templateId), "another-master-key-0123456789abcdef") }, "TOKEN_INVALID"],
			[{ intent: await sign(payload(templateId, { returnUrl: "https://evil.example/booking" })) }, "RETURN_URL_NOT_ALLOWED"],
			[{ intent: await sign(payload("missing-template")) }, "TEMPLATE_NOT_FOUND"],
			[{ intent: await sign(payload(templateId, { tplVersion: 9 })) }, "TEMPLATE_NOT_FOUND"],
			[{ intent: await sign(payload(templateId, { prefill: {} })) }, "BAD_REQUEST"],
		];
		for (const [input, code] of cases) {
			const r = await call(budget, "public/envelopes/from-intent", input);
			expect(r, code).toMatchObject({ ok: false, error: { code } });
			expect(Object.keys(r).sort(), code).toEqual(["error", "ok"].concat(code === "BAD_REQUEST" ? ["issues"] : []).sort());
		}
		expect(await runtime?.inspect.storage.list("envelopes")).toHaveLength(0);
		await runtime?.fixtures.plugin.storage("clients", CID, {
			clientId: CID,
			revokedAt: "2026-10-20T00:00:00.000Z",
			returnUrlAllowlist: ["https://events.example/booking"],
		});
		expect(
			await call(budget, "public/envelopes/from-intent", { intent: await sign(payload(templateId)) }),
		).toMatchObject({ error: { code: "CLIENT_REVOKED" } });
	});

	it("ES-FR-02 archived templates cannot start envelopes from intents", async () => {
		const { budget, templateId } = await setupIntegration();
		await budget.invokeRoute("templates/archive", { id: templateId });
		expect(
			await call(budget, "public/envelopes/from-intent", { intent: await sign(payload(templateId)) }),
		).toMatchObject({ error: { code: "TEMPLATE_NOT_FOUND" } });
	});

	it("without a master key every client is unknown (fail closed)", async () => {
		const budget = await setup();
		await runtime?.fixtures.plugin.storage("clients", CID, { clientId: CID, revokedAt: null });
		const templateId = await createTemplate(budget);
		expect(
			await call(budget, "public/envelopes/from-intent", { intent: await sign(payload(templateId)) }),
		).toMatchObject({ error: { code: "CLIENT_UNKNOWN" } });
	});
});
