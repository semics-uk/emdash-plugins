import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import {
	type CatalogPayload,
	type IntentPayload,
	type LookupPayload,
	signEsignToken,
	verifyReceiptToken,
} from "@semics-tech/shared";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";
import { derived, MASTER, nowS, routeToken, secondStart, type Vector, vectorsOf } from "./vectors";

// T062 (ES-FR-14): `public/receipts/lookup` and `public/templates/catalog` with client-signed requests
// (protocol §8.3, §8.5), and the receipt e-sign issues when the ceremony ends (§8.2). Every lookup and
// catalog vector of docs/protocol/vectors.json runs through the real route in workerd, re-minted for
// the site's clock and derived secrets (tests/vectors.ts).

const LOOKUP = "public/receipts/lookup";
const CATALOG = "public/templates/catalog";
/** R22 target: nothing here may pass 8 calls (the hard limit is 10). */
const TARGET = { calls: 8, cpuMs: 50 };
const SUBMIT_TARGET = { calls: 9, cpuMs: 50 };
const CID = "cl_testclient01";
const OTHER = "cl_testclient02";
const RETURN = "https://events.example/booking/BK7Q2M?step=waiver";
const BODY = "# Waiver\n\nI, {{signer.name}}, accept the terms.\n";
const RECEIPT_TOKEN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/;

let runtime: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

type Body = Record<string, unknown> & { ok: boolean; error?: { code: string } };

interface TemplateFixture {
	name?: string;
	status?: string;
	integrations?: boolean;
	version?: number;
}

async function seedTemplate(r: PluginRuntimeTestHost, id: string, over: TemplateFixture = {}) {
	const at = "2026-10-01T00:00:00.000Z";
	const head = {
		name: "Waiver",
		kind: "text",
		status: "active",
		public: false,
		integrations: true,
		version: 1,
		body: BODY,
		fields: ["signer.name"],
		createdAt: at,
		updatedAt: at,
		...over,
	};
	await r.fixtures.plugin.storage("templates", id, head);
	await r.fixtures.plugin.storage("templates", `${id}:v${head.version}`, { ...head, status: "version", templateId: id });
}

async function host(clients: Record<string, { revoked: boolean }> = { [CID]: { revoked: false } }): Promise<BudgetedHost> {
	await runtime?.dispose();
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost();
	const saved = await runtime.actions.plugin.updateSettings({ integrationMasterKey: MASTER });
	expect(saved.success, JSON.stringify(saved)).toBe(true);
	for (const [cid, client] of Object.entries(clients)) {
		await runtime.fixtures.plugin.storage("clients", cid, {
			name: cid,
			clientId: cid,
			createdAt: "2026-10-01T00:00:00.000Z",
			lastUsedAt: null,
			revokedAt: client.revoked ? "2026-10-02T00:00:00.000Z" : null,
			returnUrlAllowlist: ["https://events.example/booking"],
		});
	}
	await seedTemplate(runtime, "tpl_waiver");
	return withBudget(runtime);
}

async function call(budget: BudgetedHost, route: string, body: unknown, target = TARGET): Promise<Body> {
	const result = await budget.invokeRoute(route, body);
	expectWithinBudget(result, target);
	return result.value as Body;
}

// --- the vectors ---

async function runVector(v: Vector, route: string) {
	for (let attempt = 1; ; attempt++) {
		const budget = await host(Object.fromEntries(Object.entries(v.verifier.clients).map(([c, x]) => [c, x])));
		await secondStart();
		const t0 = nowS();
		const token = await routeToken(v, t0 - v.verifier.now);
		const result = await budget.invokeRoute(route, { request: token });
		if (nowS() === t0 || attempt === 3) return result;
	}
}

describe("ES-FR-14 every lookup vector through public/receipts/lookup", () => {
	const LOOKUPS = vectorsOf("lookup");
	it("the vector file has the 11 lookup vectors", () => expect(LOOKUPS).toHaveLength(11));

	it.each(LOOKUPS.map((v) => [v.name, v] as const))("%s", async (_name, v) => {
		const result = await runVector(v, LOOKUP);
		expectWithinBudget(result, TARGET);
		const body = result.value as Body;
		if (v.expected.ok) expect(body).toEqual({ ok: true, state: "none", receipt: null });
		else {
			expect(body).toMatchObject({ ok: false, error: { code: v.expected.error } });
			expect(Object.keys(body).sort()).toEqual(["error", "ok"]);
		}
	});
});

describe("ES-FR-14 every catalog vector through public/templates/catalog", () => {
	const CATALOGS = vectorsOf("catalog");
	it("the vector file has the 10 catalog vectors", () => expect(CATALOGS).toHaveLength(10));

	it.each(CATALOGS.map((v) => [v.name, v] as const))("%s", async (_name, v) => {
		const result = await runVector(v, CATALOG);
		expectWithinBudget(result, TARGET);
		const body = result.value as Body;
		if (v.expected.ok) expect(body).toEqual({ ok: true, templates: [{ id: "tpl_waiver", name: "Waiver", version: 1 }] });
		else {
			expect(body).toMatchObject({ ok: false, error: { code: v.expected.error } });
			expect(Object.keys(body).sort()).toEqual(["error", "ok"]);
		}
	});
});

// --- lookup and the receipt ---

const lookupFor = async (ref: string, cid = CID, over: Partial<LookupPayload> = {}) =>
	signEsignToken("lookup", { v: 1, typ: "lookup", cid, ts: nowS(), ref, ...over }, await derived(cid));

let nonceSeq = 0;
async function intent(budget: BudgetedHost, ref: string, cid = CID, over: Partial<IntentPayload> = {}) {
	nonceSeq++;
	const p: IntentPayload = {
		v: 1,
		typ: "intent",
		cid,
		iat: nowS(),
		exp: nowS() + 600,
		nonce: `t062nonce${String(nonceSeq).padStart(13, "0")}`,
		tpl: "tpl_waiver",
		ref,
		signer: { name: "Ada Lovelace", email: "ada@example.com" },
		prefill: {},
		returnUrl: RETURN,
		...over,
	};
	const body = await call(budget, "public/envelopes/from-intent", { intent: await signEsignToken("intent", p, await derived(cid)) }, {
		calls: 10,
		cpuMs: 50,
	});
	expect(body, JSON.stringify(body)).toMatchObject({ ok: true });
	return body as Body & { envelopeId: string; signingToken: string };
}

/** Opens the session (sent -> in_progress) so the envelope can be submitted (R31). */
async function view(budget: BudgetedHost, token: string): Promise<Body & { envelope: { docSha256: string } }> {
	return (await call(budget, "public/session", { token })) as Body & { envelope: { docSha256: string } };
}

async function submit(budget: BudgetedHost, token: string): Promise<Body> {
	const session = await view(budget, token);
	return call(
		budget,
		"public/submit",
		{
			token,
			docSha256: session.envelope.docSha256,
			consent: true,
			intent: true,
			signature: { kind: "typed", typedName: "Ada Lovelace" },
			fieldValues: {},
		},
		SUBMIT_TARGET,
	);
}

async function verifyReceipt(token: unknown, cid = CID) {
	const secret = await derived(cid);
	return verifyReceiptToken({ token, now: Date.now(), getClient: (c) => (c === cid ? { secret, revoked: false } : undefined) });
}

describe("ES-FR-14 public/receipts/lookup", () => {
	it("a lookup with a bad signature fails, and so does a missing or non-string request", async () => {
		const budget = await host();
		const good = await lookupFor("BK7Q2M:A1");
		const [payload, signature] = good.split(".") as [string, string];
		const flipped = `${payload}.${signature.startsWith("A") ? `B${signature.slice(1)}` : `A${signature.slice(1)}`}`;
		expect(await call(budget, LOOKUP, { request: flipped })).toMatchObject({ ok: false, error: { code: "TOKEN_INVALID" } });
		// Signed with another client's secret, or as a catalog request: indistinguishable (§6.2 step 5).
		const wrongKey = await signEsignToken("lookup", { v: 1, typ: "lookup", cid: CID, ts: nowS(), ref: "R" }, await derived(OTHER));
		expect(await call(budget, LOOKUP, { request: wrongKey })).toMatchObject({ ok: false, error: { code: "TOKEN_INVALID" } });
		const catalogToken = await signEsignToken("catalog", { v: 1, typ: "catalog", cid: CID, ts: nowS() }, await derived(CID));
		expect(await call(budget, LOOKUP, { request: catalogToken })).toMatchObject({ ok: false, error: { code: "TOKEN_INVALID" } });
		for (const input of [{}, { request: 42 }, null]) {
			expect(await call(budget, LOOKUP, input), JSON.stringify(input)).toMatchObject({
				ok: false,
				error: { code: "TOKEN_MALFORMED" },
			});
		}
	});

	it("none, then pending, then terminal with a receipt equal to the ceremony's (no PII)", async () => {
		const budget = await host();
		const ref = "BK7Q2M:A1";
		expect(await call(budget, LOOKUP, { request: await lookupFor(ref) })).toEqual({ ok: true, state: "none", receipt: null });
		const created = await intent(budget, ref);
		expect(await call(budget, LOOKUP, { request: await lookupFor(ref) })).toEqual({ ok: true, state: "pending", receipt: null });

		const done = await submit(budget, created.signingToken);
		expect(done).toMatchObject({ ok: true, status: "completed", returnUrl: RETURN });
		expect(done.receipt).toMatch(RECEIPT_TOKEN);
		const fromSubmit = await verifyReceipt(done.receipt);
		const stored = await runtime?.inspect.storage.get<{ docSha256: string; finalHash: string; completedAt: string }>(
			"envelopes",
			created.envelopeId,
		);
		// The redirect's receipt: the PDF is still being built (§8.2), so pdfSha256 is null.
		expect(fromSubmit).toEqual({
			ok: true,
			value: {
				v: 1,
				typ: "receipt",
				cid: CID,
				envelopeId: created.envelopeId,
				ref,
				status: "completed",
				docSha256: stored?.docSha256,
				pdfSha256: null,
				finalHash: stored?.finalHash,
				at: Math.floor(Date.parse(stored?.completedAt as string) / 1000),
			},
		});

		const found = await call(budget, LOOKUP, { request: await lookupFor(ref) });
		expect(found).toEqual({ ok: true, state: "terminal", receipt: done.receipt });
		// Receipts carry no PII (§12): nothing of the signer is in the response.
		const text = JSON.stringify(found) + Buffer.from(String(found.receipt).split(".")[0] as string, "base64url").toString();
		expect(text).not.toContain("Ada");
		expect(text).not.toContain("ada@example.com");

		// Once the signed PDF is stored, lookup issues the full receipt (§8.2).
		const pdfSha256 = "f".repeat(64);
		await runtime?.fixtures.plugin.storage("envelopes", created.envelopeId, { ...stored, pdfSha256 });
		const full = await call(budget, LOOKUP, { request: await lookupFor(ref) });
		expect(await verifyReceipt(full.receipt)).toMatchObject({ ok: true, value: { status: "completed", pdfSha256 } });
	});

	it("answers for the most recent envelope of the ref, and only among the caller's own", async () => {
		const budget = await host({ [CID]: { revoked: false }, [OTHER]: { revoked: false } });
		const ref = "BK7Q2M:A2";
		const first = await intent(budget, ref);
		await view(budget, first.signingToken);
		const declined = await call(budget, "public/decline", { token: first.signingToken });
		expect(declined).toMatchObject({ ok: true, status: "declined", returnUrl: RETURN });
		expect(await verifyReceipt(declined.receipt)).toMatchObject({
			ok: true,
			value: { envelopeId: first.envelopeId, status: "declined", pdfSha256: null, finalHash: null },
		});
		expect(await call(budget, LOOKUP, { request: await lookupFor(ref) })).toEqual({
			ok: true,
			state: "terminal",
			receipt: declined.receipt,
		});

		// The signer tries again: the newer envelope is pending, so the lookup is pending.
		const second = await intent(budget, ref);
		expect(second.envelopeId).not.toBe(first.envelopeId);
		expect(await call(budget, LOOKUP, { request: await lookupFor(ref) })).toMatchObject({ state: "pending" });

		// Another client asking about the same ref sees nothing of this client's envelopes.
		expect(await call(budget, LOOKUP, { request: await lookupFor(ref, OTHER) })).toEqual({
			ok: true,
			state: "none",
			receipt: null,
		});
	});

	it("a revoked client can no longer look up its receipts", async () => {
		const budget = await host({ [CID]: { revoked: true } });
		expect(await call(budget, LOOKUP, { request: await lookupFor("R1") })).toMatchObject({
			ok: false,
			error: { code: "CLIENT_REVOKED" },
		});
	});

	it("an admin-sent envelope has no receipt; a completed intent envelope's closed session carries it", async () => {
		const budget = await host();
		const created = await intent(budget, "BK7Q2M:A3");
		const done = await submit(budget, created.signingToken);
		const closed = await call(budget, "public/session", { token: created.signingToken });
		expect(closed).toMatchObject({ ok: true, state: "closed", status: "completed", returnUrl: RETURN, receipt: done.receipt });

		const tpl = (await budget.invokeRoute("templates/create", { name: "NDA", body: BODY })).value as {
			template: { id: string };
		};
		const env = (
			await budget.invokeRoute("envelopes/create", {
				templateId: tpl.template.id,
				title: "NDA",
				signer: { name: "Bob", email: "bob@example.com" },
			})
		).value as { envelope: { id: string } };
		expect((await budget.invokeRoute("envelopes/send", { id: env.envelope.id })).value).toMatchObject({ ok: true });
		const voided = (await budget.invokeRoute("envelopes/void", { id: env.envelope.id })).value as Body;
		expect(voided).toMatchObject({ ok: true });
		expect(JSON.stringify(voided)).not.toContain("receipt");
	});

	it("an admin void of an intent envelope is recorded so lookup issues a voided receipt", async () => {
		const budget = await host();
		const created = await intent(budget, "BK7Q2M:A4", CID, { delivery: "email" });
		expect((await budget.invokeRoute("envelopes/void", { id: created.envelopeId })).value).toMatchObject({ ok: true });
		const found = await call(budget, LOOKUP, { request: await lookupFor("BK7Q2M:A4") });
		expect(found.state).toBe("terminal");
		const stored = await runtime?.inspect.storage.get<{ closedAt: string }>("envelopes", created.envelopeId);
		expect(await verifyReceipt(found.receipt)).toMatchObject({
			ok: true,
			value: { status: "voided", at: Math.floor(Date.parse(stored?.closedAt as string) / 1000) },
		});
	});
});

// --- the catalogue ---

const catalogFor = async (cid = CID, over: Partial<CatalogPayload> = {}) =>
	signEsignToken("catalog", { v: 1, typ: "catalog", cid, ts: nowS(), ...over }, await derived(cid));

describe("ES-FR-14 public/templates/catalog", () => {
	it("lists only templates where availableToIntegrations(head) is true: id, name, version", async () => {
		const budget = await host();
		const r = runtime as PluginRuntimeTestHost;
		await seedTemplate(r, "tpl_nda", { name: "NDA", version: 4 });
		await seedTemplate(r, "tpl_off", { name: "Not for integrations", integrations: false });
		await seedTemplate(r, "tpl_old", { name: "Old, unflagged" , integrations: undefined });
		await seedTemplate(r, "tpl_gone", { name: "Archived", status: "archived" });
		const body = await call(budget, CATALOG, { request: await catalogFor() });
		expect(body).toEqual({
			ok: true,
			templates: [
				{ id: "tpl_nda", name: "NDA", version: 4 },
				{ id: "tpl_waiver", name: "Waiver", version: 1 },
			],
		});
	});

	it("a catalog request with a bad signature, a stale ts or a revoked client fails", async () => {
		const budget = await host({ [CID]: { revoked: false }, [OTHER]: { revoked: true } });
		const wrongKey = await signEsignToken("catalog", { v: 1, typ: "catalog", cid: CID, ts: nowS() }, await derived(OTHER));
		expect(await call(budget, CATALOG, { request: wrongKey })).toMatchObject({ error: { code: "TOKEN_INVALID" } });
		expect(await call(budget, CATALOG, { request: await catalogFor(CID, { ts: nowS() - 400 }) })).toMatchObject({
			error: { code: "TOKEN_EXPIRED" },
		});
		expect(await call(budget, CATALOG, { request: await catalogFor(OTHER) })).toMatchObject({
			error: { code: "CLIENT_REVOKED" },
		});
		expect(await call(budget, CATALOG, {})).toMatchObject({ error: { code: "TOKEN_MALFORMED" } });
	});

	it("an empty catalogue is an empty list", async () => {
		const budget = await host();
		await seedTemplate(runtime as PluginRuntimeTestHost, "tpl_waiver", { integrations: false });
		expect(await call(budget, CATALOG, { request: await catalogFor() })).toEqual({ ok: true, templates: [] });
	});
});
