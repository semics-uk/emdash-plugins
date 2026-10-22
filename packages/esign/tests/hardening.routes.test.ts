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
import { type AuditEventDoc, verifyAuditChain } from "../src/domain/audit";
import { DEFAULT_CONSENT_WORDING } from "../src/domain/signing";

// T117: the Severity 3 and 4 findings of the Phase 1 review (tasks/reviews/phase-1.md, findings 5-9 and 14-18),
// plus the T062 review's "signing must not depend on decrypting secrets".

const TARGET = { calls: 8, cpuMs: 50 };
const SUBMIT = { calls: 9, cpuMs: 50 };

let runtime: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

const BODY = "I, {{signer.name}}, accept the {{event}} terms.\n";
const TOKEN = "t".repeat(43);
const SITE = "https://site.test";
const MASTER = "master-key-for-tests-0123456789abcdef";
const CID = "cl_testclient01";
const IP = "203.0.113.9";

type Body = Record<string, unknown> & { ok: boolean; error?: { code: string } };

const host = () => runtime as PluginRuntimeTestHost;

async function start(site: string | null = SITE): Promise<BudgetedHost> {
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost(site ? { site: { name: "Acme", url: site } } : {});
	return withBudget(runtime);
}

async function templateId(budget: BudgetedHost): Promise<string> {
	const t = (await budget.invokeRoute("templates/create", { name: "Waiver", body: BODY, integrations: true }))
		.value as { template: { id: string } };
	return t.template.id;
}

interface Sent {
	budget: BudgetedHost;
	id: string;
	docSha256: string;
	consentSha256: string;
}

/** A sent envelope whose signer token is known. */
async function sent(budget?: BudgetedHost): Promise<Sent> {
	const b = budget ?? (await start());
	const tpl = await templateId(b);
	const created = (
		await b.invokeRoute("envelopes/create", {
			templateId: tpl,
			signer: { name: "Ada Lovelace", email: "ada@example.com" },
			fields: { event: "Gig" },
		})
	).value as { envelope: { id: string } };
	const id = created.envelope.id;
	await b.invokeRoute("envelopes/send", { id });
	const signer = await host().inspect.storage.get<Record<string, unknown>>("signers", `${id}:s1`);
	await host().fixtures.plugin.storage("signers", `${id}:s1`, { ...signer, tokenHash: await hashToken(TOKEN) });
	const snapshot = canonicalSnapshot(renderTemplate(BODY, { "signer.name": "Ada Lovelace", event: "Gig" }));
	return {
		budget: b,
		id,
		docSha256: await sha256Hex(snapshot),
		consentSha256: await sha256Hex(DEFAULT_CONSENT_WORDING),
	};
}

const good = (s: Sent, over: Record<string, unknown> = {}) => ({
	token: TOKEN,
	consent: true,
	intent: true,
	docSha256: s.docSha256,
	consentSha256: s.consentSha256,
	signature: { kind: "typed", typedName: "Ada Lovelace" },
	...over,
});

async function call(budget: BudgetedHost, route: string, input: unknown, request?: unknown): Promise<Body> {
	const r = await budget.invokeRoute(route, input, request);
	expectWithinBudget(r, route === "public/submit" ? SUBMIT : TARGET);
	return r.value as Body;
}

async function chain(id: string): Promise<AuditEventDoc[]> {
	const rows = await host().inspect.storage.list<AuditEventDoc>("audit_events");
	return rows
		.map((r) => r.data)
		.filter((e) => e.envelopeId === id)
		.sort((a, b) => a.seq - b.seq);
}

const envelopeOf = (id: string) => host().inspect.storage.get<Record<string, unknown>>("envelopes", id);
const text = (res: { blocks?: unknown }) => JSON.stringify(res.blocks);

describe("T117 finding 5: a mail scanner's GET records no view (ES-FR-04, ES-FR-05, R31)", () => {
	it("public/session without `open` shows the document and records nothing; `open: true` records the first view", async () => {
		const s = await sent();
		const before = await chain(s.id);
		const peek = await call(s.budget, "public/session", { token: TOKEN });
		expect(peek).toMatchObject({ ok: true, state: "ready", envelope: { status: "sent", docSha256: s.docSha256 } });
		expect((await envelopeOf(s.id))?.status).toBe("sent");
		expect(await chain(s.id)).toEqual(before);
		// R31 still holds: a submit needs the view the open step records.
		expect(await call(s.budget, "public/submit", good(s))).toMatchObject({ error: { code: "SESSION_REQUIRED" } });

		const opened = await call(s.budget, "public/session", { token: TOKEN, open: true });
		expect(opened).toMatchObject({ ok: true, state: "ready", envelope: { status: "in_progress" } });
		expect((await chain(s.id)).map((e) => e.type)).toEqual(["envelope.created", "envelope.sent", "signer.viewed"]);
		// Opening again adds nothing.
		await call(s.budget, "public/session", { token: TOKEN, open: true });
		expect(await chain(s.id)).toHaveLength(3);
		expect(await call(s.budget, "public/submit", good(s))).toMatchObject({ ok: true, status: "completed" });
	});
});

describe("T117 finding 6: the consent wording shown is hashed into the audit event (ES-FR-05)", () => {
	it("public/session returns the wording's SHA-256 and signer.consented records it, within the submit budget (9)", async () => {
		const budget = await start();
		await host().actions.plugin.updateSettings({ consentWording: "I agree to sign this electronically." });
		const s = { ...(await sent(budget)), consentSha256: await sha256Hex("I agree to sign this electronically.") };
		const session = await call(s.budget, "public/session", { token: TOKEN, open: true });
		expect(session.consent).toMatchObject({
			version: "1",
			wording: "I agree to sign this electronically.",
			sha256: s.consentSha256,
		});
		const r = await s.budget.invokeRoute("public/submit", good(s));
		expectWithinBudget(r, SUBMIT);
		expect(r.value).toMatchObject({ ok: true });
		const consented = (await chain(s.id)).find((e) => e.type === "signer.consented");
		expect(consented?.data).toMatchObject({ consentVersion: "1", consentSha256: s.consentSha256 });
		const signer = await host().inspect.storage.get<Record<string, unknown>>("signers", `${s.id}:s1`);
		expect(signer?.consentSha256).toBe(s.consentSha256);
	});

	it("a submit made against wording that has since changed is refused (CONSENT_CHANGED) and writes nothing", async () => {
		const s = await sent();
		await call(s.budget, "public/session", { token: TOKEN, open: true });
		await host().actions.plugin.updateSettings({ consentWording: "New wording." });
		expect(await call(s.budget, "public/submit", good(s))).toMatchObject({
			error: { code: "BAD_REQUEST" },
			issues: [{ path: "consentSha256", code: "CONSENT_CHANGED" }],
		});
		expect((await envelopeOf(s.id))?.status).toBe("in_progress");
	});
});

describe("T117 finding 15: stroke points outside 0-1 are refused (ES-FR-04)", () => {
	it("public/submit rejects a drawn signature with a point outside the unit box", async () => {
		const s = await sent();
		await call(s.budget, "public/session", { token: TOKEN, open: true });
		const strokes = [
			[
				[0.1, 0.2],
				[1.5, 0.4],
			],
		];
		expect(await call(s.budget, "public/submit", good(s, { signature: { kind: "drawn", strokes } }))).toMatchObject({
			error: { code: "BAD_REQUEST" },
			issues: [{ code: "INVALID_SIGNATURE" }],
		});
		expect((await envelopeOf(s.id))?.status).toBe("in_progress");
	});
});

describe("T117 finding 8: R29 the ceremony limiter gates the session lookup per IP", () => {
	const fromIp = { meta: { ip: IP, userAgent: null, referer: null, geo: null } };

	it("after 20 wrong tokens from one IP, even the right token is refused before any lookup", async () => {
		const s = await sent();
		for (let i = 0; i < 20; i++) {
			const r = await call(s.budget, "public/session", { token: `w${String(i).padStart(42, "0")}` }, fromIp);
			expect(r.error?.code).toBe("SIGNING_TOKEN_INVALID");
		}
		const gated = await s.budget.invokeRoute("public/session", { token: TOKEN, open: true }, fromIp);
		expect(gated.value).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
		// The gate is one KV read: no signer lookup happened.
		expectWithinBudget(gated, { calls: 1, cpuMs: 50 });
		expect((await envelopeOf(s.id))?.status).toBe("sent");
		// Another IP is not affected.
		const other = { meta: { ...fromIp.meta, ip: "198.51.100.1" } };
		expect(await call(s.budget, "public/session", { token: TOKEN, open: true }, other)).toMatchObject({ ok: true });
	});

	it("the first view stays within 8 calls with the gate, and a wrong token costs at most 4", async () => {
		const s = await sent();
		const opened = await s.budget.invokeRoute("public/session", { token: TOKEN, open: true }, fromIp);
		expectWithinBudget(opened, TARGET);
		const wrong = await s.budget.invokeRoute("public/session", { token: "w".repeat(43) }, fromIp);
		expectWithinBudget(wrong, { calls: 4, cpuMs: 50 });
	});
});

describe("T117 (T062 review): plain signing never decrypts secrets", () => {
	it("session, submit and decline work for a non-integration envelope while a stored secret is unreadable", async () => {
		const budget = await start();
		const a = await sent(budget);
		// An encrypted value this host cannot open (as after EMDASH_ENCRYPTION_KEY is lost or changed).
		await host().fixtures.plugin.setting("integrationMasterKey", { $emdash: "plugin-setting", v: 1, data: "x" });
		expect(await call(budget, "public/session", { token: TOKEN })).toMatchObject({ ok: true, state: "ready" });
		expect(await call(budget, "public/session", { token: TOKEN, open: true })).toMatchObject({ ok: true });
		expect(await call(budget, "public/submit", good(a))).toMatchObject({ ok: true, status: "completed" });
		expect(await call(budget, "public/session", { token: TOKEN })).toMatchObject({ ok: true, state: "closed" });

		// A second envelope declines the same way.
		const b = await sent(budget);
		expect(await call(budget, "public/decline", { token: TOKEN })).toMatchObject({ ok: true, status: "declined" });
		expect((await envelopeOf(b.id))?.status).toBe("declined");
	});
});

describe("T117 finding 7: admin audit events record which user acted", () => {
	it("envelope.created, envelope.sent and envelope.voided carry the acting user's id, not the email", async () => {
		await start();
		const r = host();
		const tpl = await templateId(withBudget(r));
		const user = await r.fixtures.user({ email: "clerk@example.com", name: "Clerk", role: "admin" });
		await r.admin.submit(
			"/envelopes",
			"envelope.create",
			{ title: "Gig waiver", signerName: "Ada Lovelace", signerEmail: "ada@example.com", "field:event": "Gig" },
			{ blockId: `envelope-new:${tpl}`, user },
		);
		const id = ((await r.inspect.storage.list("envelopes"))[0] as { id: string }).id;
		await r.admin.act("/envelopes", "envelope.send", { value: id, user });
		await r.admin.act("/envelopes", "envelope.void", { value: id, user });
		const events = await chain(id);
		expect(events.map((e) => e.type)).toEqual(["envelope.created", "envelope.sent", "envelope.voided"]);
		for (const e of events) {
			expect(e.actor).toBe("admin");
			expect(e.data.userId, e.type).toBe(user.id);
		}
		expect(JSON.stringify(events.map((e) => e.data))).not.toContain("clerk@example.com");
		const env = await envelopeOf(id);
		expect(await verifyAuditChain(id, events, { salt: env?.piiSalt as string })).toMatchObject({ ok: true });
	});
});

describe("T117 finding 17: the audit timeline's page action has a handler", () => {
	it("audit.page:<id> answers with the envelope's detail page", async () => {
		const s = await sent();
		const res = await host().admin.act("/envelopes", `audit.page:${s.id}`, { value: "" });
		expect(text(res)).toContain("Audit timeline");
		expect(text(res)).not.toContain("Unknown action");
		const detail = await host().admin.act("/envelopes", "envelope.open", { value: s.id });
		expect(text(detail)).toContain(`audit.page:${s.id}`);
	});
});

describe("T117 finding 18: emails never carry a relative link", () => {
	it("without a site URL, send queues no invitation and the admin says why", async () => {
		const budget = await start(null);
		const tpl = await templateId(budget);
		const created = (
			await budget.invokeRoute("envelopes/create", {
				templateId: tpl,
				signer: { name: "Ada Lovelace", email: "ada@example.com" },
				fields: { event: "Gig" },
			})
		).value as { envelope: { id: string } };
		const res = await host().admin.act("/envelopes", "envelope.send", { value: created.envelope.id });
		expect(await host().inspect.storage.list("outbox")).toHaveLength(0);
		expect(text(res)).toContain("site URL");
		const list = await host().admin.loadPage("/envelopes");
		expect(text(list)).toContain("site URL");
	});

	it("with a site URL the invitation link is absolute", async () => {
		const s = await sent();
		const rows = await host().inspect.storage.list<{ message: { text: string } }>("outbox");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.data.message.text).toContain(`${SITE}/sign/`);
		expect(s.id).toBeTruthy();
	});
});

// --- finding 9: intent-finish convergence ---

const NOW_S = () => Math.floor(Date.now() / 1000);
let nonceSeq = 0;

function payload(tpl: string, over: Partial<IntentPayload> = {}): IntentPayload {
	nonceSeq++;
	return {
		v: 1,
		typ: "intent",
		cid: CID,
		iat: NOW_S(),
		exp: NOW_S() + 600,
		nonce: `nonce${String(nonceSeq).padStart(17, "0")}`,
		tpl,
		ref: "BK7Q2M:A1",
		signer: { name: "Ada Lovelace", email: "ada@example.com" },
		prefill: { event: "Gig" },
		returnUrl: "https://events.example/booking/BK7Q2M",
		...over,
	};
}

async function signIntent(p: IntentPayload): Promise<string> {
	return signEsignToken("intent", p, await deriveClientSecret(new TextEncoder().encode(MASTER), p.cid));
}

/** An email-delivery retry: the route stores a draft and schedules `intent-finish-<id>` (T113). */
async function draftFromRetry(): Promise<{ budget: BudgetedHost; id: string }> {
	const budget = await start();
	await host().actions.plugin.updateSettings({ integrationMasterKey: MASTER });
	await host().fixtures.plugin.storage("clients", CID, {
		name: "Events",
		clientId: CID,
		createdAt: "2026-10-01T00:00:00.000Z",
		revokedAt: null,
		returnUrlAllowlist: ["https://events.example/booking"],
	});
	const tpl = await templateId(budget);
	const first = (await budget.invokeRoute("public/envelopes/from-intent", { intent: await signIntent(payload(tpl)) }))
		.value as Body;
	const stored = await envelopeOf(first.envelopeId as string);
	await host().fixtures.plugin.storage("envelopes", first.envelopeId as string, { ...stored, status: "voided" });
	const retried = (
		await budget.invokeRoute("public/envelopes/from-intent", {
			intent: await signIntent(payload(tpl, { delivery: "email" })),
		})
	).value as Body;
	expect(retried).toMatchObject({ ok: true, status: "draft" });
	return { budget, id: retried.envelopeId as string };
}

const linkToken = (t: string) => /\/sign\/([A-Za-z0-9_-]+)/.exec(t)?.[1] as string;

async function invitationMatchesSigner(id: string): Promise<string> {
	const row = await host().inspect.storage.get<{ message: { text: string } }>("outbox", `invite-${id}:s1`);
	const signer = await host().inspect.storage.get<{ tokenHash: string }>("signers", `${id}:s1`);
	const token = linkToken(row?.message.text ?? "");
	expect(await hashToken(token)).toBe(signer?.tokenHash);
	return token;
}

describe("T117 finding 9: overlapping intent-finish runs converge on one token", () => {
	it("a run that re-does the work picks the same token, so the signer and the invitation never disagree", async () => {
		const { budget, id } = await draftFromRetry();
		const event = { name: `intent-finish-${id}`, scheduledAt: new Date().toISOString(), data: { envelopeId: id } };
		const draft = await envelopeOf(id);
		const first = await budget.invokeHook("cron", event);
		expectWithinBudget(first, TARGET);
		const token1 = await invitationMatchesSigner(id);
		// A second run that read the envelope while it was still a draft (it overlapped the first) writes again.
		await host().fixtures.plugin.storage("envelopes", id, draft);
		const second = await budget.invokeHook("cron", event);
		expectWithinBudget(second, TARGET);
		const token2 = await invitationMatchesSigner(id);
		expect(token2).toBe(token1);
	});

	it("two concurrent runs leave the signer's token hash and the queued invitation in step", async () => {
		const { budget, id } = await draftFromRetry();
		const event = { name: `intent-finish-${id}`, scheduledAt: new Date().toISOString(), data: { envelopeId: id } };
		const runs = await Promise.all([budget.invokeHook("cron", event), budget.invokeHook("cron", event)]);
		for (const r of runs) expectWithinBudget(r, TARGET);
		expect((await envelopeOf(id))?.status).toBe("sent");
		await invitationMatchesSigner(id);
	});
});
