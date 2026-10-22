import { createHmac } from "node:crypto";
import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { deriveClientSecret, hashToken, type IntentPayload, signEsignToken } from "@semics-tech/shared";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";
import VECTORS from "../../../docs/protocol/vectors.json";

// T061 (ES-FR-13, SX-NFR-02, SX-NFR-03): every `intent` vector of docs/protocol/vectors.json through
// the real `public/envelopes/from-intent` route in workerd, plus the route-level rules the vectors
// cannot express: replay, the return-URL allowlist, `(cid, ref)` idempotency and the "available to
// integrations" template flag.
//
// The route derives each client's secret from the master key (S8) and reads the real clock, so a
// vector cannot be replayed byte for byte: its payload text is kept, `iat`/`exp` are shifted by
// (now - vector.verifier.now), and it is re-signed with the derived secret of the key the vector
// used. Tokens that fail before a key is chosen (malformed, oversize) are sent unchanged. Every
// vector gets a fresh host seeded with its own client table and consumed nonces, and a vector whose
// call straddled a second boundary is re-run (the inclusive skew boundaries are exact to the second).

interface Vector {
	name: string;
	type: string;
	input: {
		token: string;
		signedWithPrefix?: string;
		signedWithSecret?: string;
		payload?: Record<string, unknown>;
		tamper?: string;
	};
	verifier: {
		now: number;
		clients: Record<string, { secret: string; revoked: boolean; returnUrlAllowlist?: string[] }>;
		usedNonces: Array<{ cid: string; nonce: string }>;
	};
	expected: { ok: true; payload: Record<string, unknown> } | { ok: false; error: string };
}

const FILE = VECTORS as unknown as {
	keys: Record<string, { cid: string; secret: string }>;
	vectors: Vector[];
};
const INTENT_VECTORS = FILE.vectors.filter((v) => v.type === "intent");

/** R22: fresh intents are 8 calls inline and 9 with email delivery (T113); nothing may pass 10. */
const INLINE_TARGET = { calls: 8, cpuMs: 50 };
const EMAIL_TARGET = { calls: 9, cpuMs: 50 };
const ROUTE = "public/envelopes/from-intent";
const MASTER = "master-key-for-tests-0123456789abcdef";
const TEMPLATE_ID = "tpl_waiver";
const BODY = "# Waiver\n\nI, {{signer.name}}, accept the terms.\n";

let runtime: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

type Body = Record<string, unknown> & { ok: boolean; error?: { code: string } };

const b64url = (bytes: Buffer) => bytes.toString("base64url");
const nowS = () => Math.floor(Date.now() / 1000);

async function derived(cid: string): Promise<Buffer> {
	return Buffer.from(await deriveClientSecret(new TextEncoder().encode(MASTER), cid));
}

/** The cid whose derived secret stands in for the vector's raw test secret. */
function keyCid(secret: string): string {
	const key = Object.values(FILE.keys).find((k) => k.secret === secret);
	if (!key) throw new Error(`vector secret ${secret} is not one of the test keys`);
	return key.cid;
}

const shiftTimes = (text: string, shift: number) =>
	text.replace(/"(iat|exp)":(\d+)/g, (_m, field: string, n: string) => `"${field}":${Number(n) + shift}`);

async function sig(secret: string, prefix: string, payloadB64: string): Promise<Buffer> {
	return createHmac("sha256", await derived(keyCid(secret)))
		.update(`${prefix}.${payloadB64}`)
		.digest();
}

/** The vector's token as this site would see it now (see the header comment). */
async function routeToken(v: Vector, shift: number): Promise<string> {
	const expectedError = v.expected.ok ? undefined : v.expected.error;
	if (expectedError === "TOKEN_MALFORMED" || expectedError === "TOKEN_TOO_LARGE") return v.input.token;
	const { signedWithPrefix: prefix, signedWithSecret: secret, tamper } = v.input;
	if (!prefix || !secret) throw new Error(`${v.name}: no signing key`);
	const [segment] = v.input.token.split(".");
	const text = shiftTimes(Buffer.from(segment as string, "base64url").toString("utf8"), shift);
	const payloadB64 = b64url(Buffer.from(text, "utf8"));
	let signature: Buffer;
	if (tamper === "payload segment replaced") {
		// Signed over a different payload (the one before the edit); the edited payload is sent.
		const original = INTENT_VECTORS.find((x) => x.name === "intent/valid-minimal") as Vector;
		const originalText = shiftTimes(
			Buffer.from(original.input.token.split(".")[0] as string, "base64url").toString("utf8"),
			shift,
		);
		signature = await sig(secret, prefix, b64url(Buffer.from(originalText, "utf8")));
	} else {
		signature = await sig(secret, prefix, payloadB64);
		if (tamper === "signature bit flipped") signature[0] = (signature[0] as number) ^ 1;
		else if (tamper !== undefined) throw new Error(`${v.name}: unknown tamper ${tamper}`);
	}
	const token = `${payloadB64}.${b64url(signature)}`;
	// Same digit count for the times, so a max-length vector stays exactly at its length.
	expect(token.length, v.name).toBe(v.input.token.length);
	return token;
}

interface TemplateFixture {
	integrations?: boolean;
	status?: string;
}

async function seedTemplate(r: PluginRuntimeTestHost, over: TemplateFixture = {}, id = TEMPLATE_ID) {
	const at = "2026-10-01T00:00:00.000Z";
	const head = {
		name: "Waiver",
		kind: "text",
		status: "active",
		public: false,
		integrations: true,
		version: 3,
		body: BODY,
		fields: ["signer.name"],
		createdAt: at,
		updatedAt: at,
		...over,
	};
	await r.fixtures.plugin.storage("templates", id, head);
	for (const n of [1, 2, 3]) {
		await r.fixtures.plugin.storage("templates", `${id}:v${n}`, {
			...head,
			status: "version",
			version: n,
			templateId: id,
		});
	}
}

/** A host with the vector's client table, consumed nonces and the `tpl_waiver` template. */
async function vectorHost(v: Vector): Promise<BudgetedHost> {
	await runtime?.dispose();
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost();
	const r = runtime;
	const saved = await r.actions.plugin.updateSettings({ integrationMasterKey: MASTER });
	expect(saved.success, JSON.stringify(saved)).toBe(true);
	for (const [cid, client] of Object.entries(v.verifier.clients)) {
		await r.fixtures.plugin.storage("clients", cid, {
			name: cid,
			clientId: cid,
			createdAt: "2026-10-01T00:00:00.000Z",
			lastUsedAt: null,
			revokedAt: client.revoked ? "2026-10-02T00:00:00.000Z" : null,
			returnUrlAllowlist: client.returnUrlAllowlist ?? [],
		});
	}
	for (const used of v.verifier.usedNonces) {
		const id = `${used.cid}.${used.nonce}`;
		await r.fixtures.plugin.storage("nonces", id, {
			nonce: id,
			cid: used.cid,
			expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
		});
	}
	await seedTemplate(r);
	return withBudget(r);
}

/** Waits for the start of a second, so a call can finish inside the second its token was built in. */
async function secondStart(): Promise<void> {
	const ms = Date.now() % 1000;
	if (ms > 150) await new Promise((resolve) => setTimeout(resolve, 1005 - ms));
}

async function runVector(v: Vector) {
	for (let attempt = 1; ; attempt++) {
		const budget = await vectorHost(v);
		const noncesBefore = (await runtime?.inspect.storage.list("nonces"))?.length ?? 0;
		await secondStart();
		const t0 = nowS();
		const token = await routeToken(v, t0 - v.verifier.now);
		const result = await budget.invokeRoute(ROUTE, { intent: token });
		if (nowS() === t0 || attempt === 3) return { result, body: result.value as Body, noncesBefore, shift: t0 - v.verifier.now };
	}
}

describe("ES-FR-13 SX-NFR-02 every intent vector through public/envelopes/from-intent", () => {
	it("the vector file has the 53 intent vectors the route must honour", () => {
		expect(INTENT_VECTORS).toHaveLength(53);
	});

	it.each(INTENT_VECTORS.map((v) => [v.name, v] as const))("%s", async (_name, v) => {
		const { result, body, noncesBefore, shift } = await runVector(v);
		const r = runtime as PluginRuntimeTestHost;
		const envelopes = await r.inspect.storage.list<Record<string, unknown>>("envelopes");
		const nonces = await r.inspect.storage.list<{ cid: string; expiresAt: string }>("nonces");
		if (!v.expected.ok) {
			expectWithinBudget(result, INLINE_TARGET);
			expect(body).toMatchObject({ ok: false, error: { code: v.expected.error } });
			expect(Object.keys(body).sort()).toEqual(["error", "ok"]);
			// A rejected intent never creates anything and never burns a nonce (§6.2 step 9).
			expect(envelopes).toHaveLength(0);
			expect(nonces).toHaveLength(noncesBefore);
			return;
		}
		const p = v.expected.payload as unknown as IntentPayload;
		const delivery = p.delivery ?? "inline";
		expectWithinBudget(result, delivery === "email" ? EMAIL_TARGET : INLINE_TARGET);
		expect(body).toMatchObject({ ok: true, status: "sent" });
		expect(body.signingToken !== undefined).toBe(delivery === "inline");
		// The nonce is recorded as `nonces/<cid>.<nonce>`, kept until exp + 60 s (ISO).
		const recorded = nonces.find((n) => n.id === `${p.cid}.${p.nonce}`);
		expect(recorded?.data.cid).toBe(p.cid);
		expect(recorded?.data.expiresAt).toBe(new Date((p.exp + shift + 60) * 1000).toISOString());
		expect(envelopes).toHaveLength(1);
		expect(envelopes[0]?.id).toBe(body.envelopeId);
		expect(envelopes[0]?.data).toMatchObject({
			status: "sent",
			clientId: p.cid,
			externalRef: p.ref,
			returnUrl: p.returnUrl,
			delivery,
			templateVersion: p.tplVersion ?? 3,
			fieldValues: p.prefill,
			signer: {
				name: p.signer.name,
				email: p.signer.email.toLowerCase(),
				as: p.as ?? "self",
				...(p.participant ? { participant: { name: p.participant.name } } : {}),
			},
		});
	});
});

// --- the route rules beyond the vectors ---

const CID = "cl_testclient01";
let nonceSeq = 0;

function payload(over: Partial<IntentPayload> = {}): IntentPayload {
	nonceSeq++;
	return {
		v: 1,
		typ: "intent",
		cid: CID,
		iat: nowS(),
		exp: nowS() + 600,
		nonce: `t061nonce${String(nonceSeq).padStart(13, "0")}`,
		tpl: TEMPLATE_ID,
		ref: "BK7Q2M:A1",
		signer: { name: "Ada Lovelace", email: "ada@example.com" },
		prefill: {},
		returnUrl: "https://events.example/booking/BK7Q2M",
		...over,
	};
}

async function sign(p: IntentPayload): Promise<string> {
	return signEsignToken("intent", p, await derived(p.cid));
}

async function integration(template: TemplateFixture = {}): Promise<BudgetedHost> {
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost();
	await runtime.actions.plugin.updateSettings({ integrationMasterKey: MASTER });
	await runtime.fixtures.plugin.storage("clients", CID, {
		name: "Events",
		clientId: CID,
		createdAt: "2026-10-01T00:00:00.000Z",
		revokedAt: null,
		returnUrlAllowlist: ["https://events.example/booking"],
	});
	await seedTemplate(runtime, template);
	return withBudget(runtime);
}

async function call(budget: BudgetedHost, token: string, target = INLINE_TARGET): Promise<Body> {
	const r = await budget.invokeRoute(ROUTE, { intent: token });
	expectWithinBudget(r, target);
	return r.value as Body;
}

describe("ES-FR-13 SX-NFR-03 from-intent route rules", () => {
	it("SX-NFR-03 a replayed intent is rejected with TOKEN_REPLAYED and changes nothing", async () => {
		const budget = await integration();
		const token = await sign(payload());
		const first = await call(budget, token);
		expect(first).toMatchObject({ ok: true, status: "sent" });
		const before = await runtime?.inspect.storage.list("signers");
		const replay = await call(budget, token);
		expect(replay).toEqual({ ok: false, error: expect.objectContaining({ code: "TOKEN_REPLAYED" }) });
		// No token rotation on a replay: the signer still holds the first token.
		expect(await runtime?.inspect.storage.list("signers")).toEqual(before);
		const signer = (before?.[0]?.data ?? {}) as { tokenHash?: string };
		expect(signer.tokenHash).toBe(await hashToken(first.signingToken as string));
	});

	it("SX-NFR-02 an off-allowlist return URL is rejected before the nonce is consumed", async () => {
		const budget = await integration();
		const p = payload({ returnUrl: "https://evil.example/booking/BK7Q2M" });
		expect(await call(budget, await sign(p))).toMatchObject({ ok: false, error: { code: "RETURN_URL_NOT_ALLOWED" } });
		for (const returnUrl of [
			"https://events.example/bookings",
			"https://events.example:8443/booking",
			"http://events.example/booking",
			"https://events.example/booking#x",
		]) {
			const r = await call(budget, await sign(payload({ returnUrl })));
			expect(r, returnUrl).toMatchObject({ ok: false, error: { code: "RETURN_URL_NOT_ALLOWED" } });
		}
		expect(await runtime?.inspect.storage.list("nonces")).toHaveLength(0);
		expect(await runtime?.inspect.storage.list("envelopes")).toHaveLength(0);
		// The same nonce is still usable with an allowed URL.
		const ok = await call(budget, await sign({ ...p, returnUrl: "https://events.example/booking/BK7Q2M" }));
		expect(ok).toMatchObject({ ok: true, status: "sent" });
	});

	it("ES-FR-13 the same (cid, ref) returns the same envelope; another ref or client gets its own", async () => {
		const budget = await integration();
		const first = await call(budget, await sign(payload()));
		const again = await call(budget, await sign(payload({ signer: { name: "Someone Else", email: "x@example.com" } })));
		expect(again).toMatchObject({ ok: true, envelopeId: first.envelopeId, status: "sent" });
		const email = await call(budget, await sign(payload({ delivery: "email" })));
		expect(email).toMatchObject({ ok: true, envelopeId: first.envelopeId });
		const stored = await runtime?.inspect.storage.get<{ signer: { name: string } }>(
			"envelopes",
			first.envelopeId as string,
		);
		// The intent's other fields are ignored for an existing envelope.
		expect(stored?.signer.name).toBe("Ada Lovelace");
		const other = await call(budget, await sign(payload({ ref: "BK7Q2M:A2" })));
		expect(other).toMatchObject({ ok: true });
		expect(other.envelopeId).not.toBe(first.envelopeId);
		expect(await runtime?.inspect.storage.list("envelopes")).toHaveLength(2);
	});

	it("ES-FR-13 a template not flagged available to integrations is TEMPLATE_NOT_FOUND", async () => {
		const budget = await integration({ integrations: false });
		const r = await call(budget, await sign(payload()));
		expect(r).toMatchObject({ ok: false, error: { code: "TEMPLATE_NOT_FOUND" } });
		expect(await runtime?.inspect.storage.list("envelopes")).toHaveLength(0);
		// A route error after verification: the nonce is spent, so the client mints a new intent (§8.1).
		expect(await runtime?.inspect.storage.list("nonces")).toHaveLength(1);
	});

	it("ES-FR-13 a template without the flag (created before T061) is refused too", async () => {
		const budget = await integration({ integrations: undefined });
		expect(await call(budget, await sign(payload()))).toMatchObject({
			ok: false,
			error: { code: "TEMPLATE_NOT_FOUND" },
		});
	});

	it("ES-FR-13 the flag is set through templates/create and templates/update", async () => {
		const budget = await integration();
		const created = (await budget.invokeRoute("templates/create", { name: "NDA", body: BODY, integrations: true }))
			.value as { template: { id: string; integrations: boolean } };
		expect(created.template.integrations).toBe(true);
		const id = created.template.id;
		const ok = await call(budget, await sign(payload({ tpl: id, ref: "R1" })));
		expect(ok).toMatchObject({ ok: true, status: "sent" });
		const updated = (await budget.invokeRoute("templates/update", { id, name: "NDA", body: BODY, integrations: false }))
			.value as { template: { integrations: boolean } };
		expect(updated.template.integrations).toBe(false);
		expect(await call(budget, await sign(payload({ tpl: id, ref: "R2" })))).toMatchObject({
			error: { code: "TEMPLATE_NOT_FOUND" },
		});
		// Default off; a non-boolean flag is a bad request.
		const plain = (await budget.invokeRoute("templates/create", { name: "Plain", body: BODY })).value as {
			template: { integrations: boolean };
		};
		expect(plain.template.integrations).toBe(false);
		const bad = (await budget.invokeRoute("templates/create", { name: "Bad", body: BODY, integrations: "yes" }))
			.value as Body;
		expect(bad).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
	});
});
