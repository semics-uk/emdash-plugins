import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { canonicalSnapshot, hashToken, renderTemplate, sha256Hex } from "@semics-tech/shared";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";
import { type AuditEventDoc, finalEnvelopeHash, verifyAuditChain } from "../src/domain/audit";

/** R22: target ≤ 8 bridge calls per route; submit is at 9 since it schedules the signed-PDF job (T025). */
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

type Body = Record<string, unknown> & { ok: boolean; error?: { code: string } };

interface Sent {
	budget: BudgetedHost;
	id: string;
	docSha256: string;
	snapshot: string;
}

async function call(budget: BudgetedHost, route: string, input: unknown): Promise<Body> {
	const r = await budget.invokeRoute(route, input);
	expectWithinBudget(r, route === "public/submit" ? SUBMIT : TARGET);
	return r.value as Body;
}

/** A sent envelope whose signer token is known (the real token is only emailed, T027). */
async function sent(extra: Record<string, unknown> = {}): Promise<Sent> {
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost();
	const budget = withBudget(runtime);
	const t = (await budget.invokeRoute("templates/create", { name: "Waiver", body: BODY })).value as {
		template: { id: string };
	};
	const created = (
		await budget.invokeRoute("envelopes/create", {
			templateId: t.template.id,
			signer: { name: "Ada Lovelace", email: "ada@example.com" },
			fields: { event: "Gig" },
			...extra,
		})
	).value as { envelope: { id: string } };
	const id = created.envelope.id;
	await budget.invokeRoute("envelopes/send", { id });
	const signer = await runtime.inspect.storage.get<Record<string, unknown>>("signers", `${id}:s1`);
	await runtime.fixtures.plugin.storage("signers", `${id}:s1`, { ...signer, tokenHash: await hashToken(TOKEN) });
	const snapshot = canonicalSnapshot(renderTemplate(BODY, { "signer.name": "Ada Lovelace", event: "Gig" }));
	return { budget, id, snapshot, docSha256: await sha256Hex(snapshot) };
}

const good = (s: Sent, over: Record<string, unknown> = {}) => ({
	token: TOKEN,
	consent: true,
	intent: true,
	docSha256: s.docSha256,
	signature: { kind: "typed", typedName: "Ada Lovelace" },
	...over,
});

/** The ceremony always opens the page first: `public/session` does the `sent -> in_progress` view transition. */
const view = (s: Sent) => call(s.budget, "public/session", { token: TOKEN });

async function chain(id: string): Promise<AuditEventDoc[]> {
	const rows = (await runtime?.inspect.storage.list<AuditEventDoc>("audit_events")) ?? [];
	return rows
		.map((r) => r.data)
		.filter((e) => e.envelopeId === id)
		.sort((a, b) => a.seq - b.seq);
}

const envelopeOf = (id: string) => runtime?.inspect.storage.get<Record<string, unknown>>("envelopes", id);

describe("ES-FR-04 public/session", () => {
	it("ES-FR-04 returns the snapshot, consent wording and the signer's own name, and records the first view", async () => {
		const s = await sent();
		const r = await call(s.budget, "public/session", { token: TOKEN });
		expect(r).toMatchObject({
			ok: true,
			state: "ready",
			snapshot: s.snapshot,
			envelope: { id: s.id, docSha256: s.docSha256, status: "in_progress" },
			signer: { name: "Ada Lovelace" },
			consent: { version: "1" },
		});
		expect(typeof (r.consent as { wording: string }).wording).toBe("string");
		const text = JSON.stringify(r);
		expect(text).not.toContain("tokenHash");
		expect(text).not.toContain("piiSalt");
		expect(text).not.toContain("ada@example.com");
		expect((await envelopeOf(s.id))?.status).toBe("in_progress");
		expect((await chain(s.id)).map((e) => e.type)).toEqual(["envelope.created", "envelope.sent", "signer.viewed"]);

		// A second view changes nothing and adds no event.
		const again = await call(s.budget, "public/session", { token: TOKEN });
		expect(again).toMatchObject({ ok: true, state: "ready" });
		expect(await chain(s.id)).toHaveLength(3);
	});

	it("ES-FR-04 a wrong or missing token is SIGNING_TOKEN_INVALID and a token in the URL is refused", async () => {
		const s = await sent();
		expect(await call(s.budget, "public/session", { token: "w".repeat(43) })).toMatchObject({
			ok: false,
			error: { code: "SIGNING_TOKEN_INVALID" },
		});
		expect(await call(s.budget, "public/session", {})).toMatchObject({ error: { code: "SIGNING_TOKEN_INVALID" } });
		const viaUrl = await s.budget.invokeRoute(
			"public/session",
			{ token: TOKEN },
			new Request(`https://x.test/?token=${TOKEN}`),
		);
		expect((viaUrl.value as Body).error?.code).toBe("TOKEN_IN_QUERY");
	});

	it("ES-FR-04 a finished envelope shows its state and no document", async () => {
		const s = await sent();
		await view(s);
		await call(s.budget, "public/submit", good(s));
		const r = await call(s.budget, "public/session", { token: TOKEN });
		expect(r).toMatchObject({ ok: true, state: "closed", status: "completed" });
		expect(r.snapshot).toBeUndefined();
	});

	it("ES-FR-04 an expired link is SIGNING_TOKEN_EXPIRED", async () => {
		const s = await sent();
		const env = await envelopeOf(s.id);
		await runtime?.fixtures.plugin.storage("envelopes", s.id, { ...env, expiresAt: "2020-01-01T00:00:00.000Z" });
		expect(await call(s.budget, "public/session", { token: TOKEN })).toMatchObject({
			error: { code: "SIGNING_TOKEN_EXPIRED" },
		});
	});
});

describe("ES-FR-04 public/submit", () => {
	it("ES-FR-04 fails without consent or without the intent flag", async () => {
		const s = await sent();
		for (const over of [{ consent: false }, { consent: undefined }, { intent: false }, { intent: "yes" }]) {
			expect(await call(s.budget, "public/submit", good(s, over))).toMatchObject({
				ok: false,
				error: { code: "BAD_REQUEST" },
			});
		}
		expect((await envelopeOf(s.id))?.status).toBe("sent");
		expect(await chain(s.id)).toHaveLength(2);
	});

	it("ES-FR-04 rejects stroke JSON over 32 KB, empty signatures and a stale document hash", async () => {
		const s = await sent();
		await view(s);
		const stroke = Array.from({ length: 3000 }, (_, i) => [i / 3000, 0.123456]);
		const big = await call(
			s.budget,
			"public/submit",
			good(s, { signature: { kind: "drawn", strokes: [stroke, stroke] } }),
		);
		expect(big).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" }, issues: [{ code: "STROKES_TOO_LARGE" }] });
		expect(
			await call(s.budget, "public/submit", good(s, { signature: { kind: "typed", typedName: " " } })),
		).toMatchObject({ error: { code: "BAD_REQUEST" } });
		expect(await call(s.budget, "public/submit", good(s, { docSha256: "0".repeat(64) }))).toMatchObject({
			error: { code: "BAD_REQUEST" },
			issues: [{ code: "DOC_CHANGED" }],
		});
		expect((await envelopeOf(s.id))?.status).toBe("in_progress");
	});

	it("ES-FR-04 a wrong token fails and a used token fails", async () => {
		const s = await sent();
		await view(s);
		expect(await call(s.budget, "public/submit", good(s, { token: "w".repeat(43) }))).toMatchObject({
			error: { code: "SIGNING_TOKEN_INVALID" },
		});
		expect(await call(s.budget, "public/submit", good(s))).toMatchObject({ ok: true });
		expect(await call(s.budget, "public/submit", good(s))).toMatchObject({
			error: { code: "SIGNING_TOKEN_INVALID" },
		});
		expect(await chain(s.id)).toHaveLength(6);
	});

	it("ES-FR-04 a completed submit stores the signature, writes the audit events and completes the envelope", async () => {
		const s = await sent();
		await call(s.budget, "public/session", { token: TOKEN });
		const strokes = [
			[
				[0.1, 0.2],
				[0.3, 0.4],
			],
		];
		const r = await call(
			s.budget,
			"public/submit",
			good(s, { signature: { kind: "drawn", typedName: "Ada", strokes } }),
		);
		expect(r).toMatchObject({ ok: true, status: "completed" });
		expect(JSON.stringify(r)).not.toContain("piiSalt");

		const env = await envelopeOf(s.id);
		expect(env).toMatchObject({ status: "completed", docSha256: s.docSha256 });
		expect(typeof env?.completedAt).toBe("string");

		const events = await chain(s.id);
		expect(events.map((e) => e.type)).toEqual([
			"envelope.created",
			"envelope.sent",
			"signer.viewed",
			"signer.consented",
			"signer.signed",
			"envelope.completed",
		]);
		const verified = await verifyAuditChain(s.id, events, { salt: env?.piiSalt as string });
		expect(verified).toMatchObject({ ok: true });
		expect(env?.finalHash).toBe(await finalEnvelopeHash(s.docSha256, events.at(-1)?.hash as string));
		expect(events[4]?.data).toMatchObject({ docSha256: s.docSha256, kind: "drawn" });

		const signer = await runtime?.inspect.storage.get<Record<string, unknown>>("signers", `${s.id}:s1`);
		expect(signer).toMatchObject({ status: "signed", consentVersion: "1", signature: { kind: "drawn", strokes } });
		const expectedSha = await sha256Hex(JSON.stringify([s.docSha256, "drawn", "Ada", strokes]));
		expect((signer?.signature as { sha256: string } | undefined)?.sha256).toBe(expectedSha);
	});

	it("R31 submit against a sent envelope is SESSION_REQUIRED and writes nothing", async () => {
		const s = await sent();
		const before = await chain(s.id);
		const r = await s.budget.invokeRoute("public/submit", good(s));
		expectWithinBudget(r, SUBMIT);
		expect(r.value).toMatchObject({ ok: false, error: { code: "SESSION_REQUIRED" } });
		expect((await envelopeOf(s.id))?.status).toBe("sent");
		expect(await chain(s.id)).toEqual(before);
		const signer = await runtime?.inspect.storage.get<Record<string, unknown>>("signers", `${s.id}:s1`);
		expect(signer?.status).toBe("pending");
		// The same link works once the page has been opened.
		await view(s);
		expect(await call(s.budget, "public/submit", good(s))).toMatchObject({ ok: true, status: "completed" });
	});

	it("R31 after public/session, submit completes within 9 calls and the chain verifies to finalHash", async () => {
		const s = await sent();
		await view(s);
		const r = await s.budget.invokeRoute("public/submit", good(s));
		expectWithinBudget(r, SUBMIT);
		expect(r.value).toMatchObject({ ok: true });
		const env = await envelopeOf(s.id);
		const events = await chain(s.id);
		expect(await verifyAuditChain(s.id, events, { salt: env?.piiSalt as string })).toMatchObject({ ok: true });
		expect(env?.finalHash).toBe(await finalEnvelopeHash(s.docSha256, events.at(-1)?.hash as string));
	});

	it("R31 two concurrent submits: one completes, the other CONFLICTs; neither exceeds 10 calls", async () => {
		const s = await sent();
		await view(s);
		const [a, b] = await Promise.all([
			s.budget.invokeRoute("public/submit", good(s)),
			s.budget.invokeRoute("public/submit", good(s)),
		]);
		for (const r of [a, b]) expectWithinBudget(r, { calls: 10, cpuMs: 50 });
		const codes = [a, b].map((r) => ((r.value as Body).ok ? "ok" : (r.value as Body).error?.code));
		expect(codes.filter((c) => c === "ok")).toHaveLength(1);
		expect(
			codes.filter((c) => c === "ENVELOPE_CLOSED" || c === "SIGNING_TOKEN_INVALID" || c === "CONFLICT"),
		).toHaveLength(1);
		const env = await envelopeOf(s.id);
		const events = await chain(s.id);
		expect(await verifyAuditChain(s.id, events, { salt: env?.piiSalt as string })).toMatchObject({ ok: true });
	});

	it("ES-FR-04 a signed link cannot decline afterwards", async () => {
		const s = await sent();
		await view(s);
		await call(s.budget, "public/submit", good(s));
		expect((await envelopeOf(s.id))?.status).toBe("completed");
		expect(await call(s.budget, "public/decline", { token: TOKEN })).toMatchObject({
			error: { code: "SIGNING_TOKEN_INVALID" },
		});
	});

	it("ES-FR-04 responses contain no other signer's data", async () => {
		const s = await sent();
		const other = {
			envelopeId: "other",
			order: 1,
			role: "signer",
			name: "Grace Hopper",
			email: "grace@example.com",
			as: "self",
			status: "pending",
			tokenHash: await hashToken("o".repeat(43)),
			createdAt: "2026-10-21T10:00:00.000Z",
		};
		await runtime?.fixtures.plugin.storage("signers", "other:s1", other);
		const session = await call(s.budget, "public/session", { token: TOKEN });
		const submit = await call(s.budget, "public/submit", good(s));
		for (const body of [session, submit]) {
			expect(JSON.stringify(body)).not.toMatch(/grace|Hopper|other/i);
		}
	});
});

describe("ES-FR-04 public/decline", () => {
	it("ES-FR-04 declines through the state machine and writes signer.declined and envelope.declined", async () => {
		const s = await sent();
		const r = await call(s.budget, "public/decline", { token: TOKEN, reason: "Not now" });
		expect(r).toMatchObject({ ok: true, status: "declined" });
		expect((await envelopeOf(s.id))?.status).toBe("declined");
		const events = await chain(s.id);
		expect(events.map((e) => e.type)).toEqual([
			"envelope.created",
			"envelope.sent",
			"signer.declined",
			"envelope.declined",
		]);
		expect(await verifyAuditChain(s.id, events, { salt: (await envelopeOf(s.id))?.piiSalt as string })).toMatchObject({
			ok: true,
		});
		expect(await call(s.budget, "public/submit", good(s))).toMatchObject({
			error: { code: "SIGNING_TOKEN_INVALID" },
		});
		expect(await call(s.budget, "public/decline", { token: "w".repeat(43) })).toMatchObject({
			error: { code: "SIGNING_TOKEN_INVALID" },
		});
	});
});

describe("T033 signer-fillable fields", () => {
	const signerFields = [
		{ key: "phone", label: "Phone number", required: true },
		{ key: "nickname", label: "Nickname" },
	];

	it("public/session lists the fields the sender asked the signer to fill, and none otherwise", async () => {
		const s = await sent({ signerFields });
		expect(await view(s)).toMatchObject({ ok: true, state: "ready", fields: signerFields });
	});

	it("public/session lists no fields when the sender asked for none", async () => {
		const plain = await sent();
		expect((await view(plain)).fields).toBeUndefined();
	});

	it("public/submit refuses a missing required field and an undeclared one, and stores the declared values", async () => {
		const s = await sent({ signerFields });
		await view(s);
		expect(await call(s.budget, "public/submit", good(s, { fieldValues: { nickname: "Ada" } }))).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST" },
		});
		expect(await call(s.budget, "public/submit", good(s, { fieldValues: { phone: "1", other: "x" } }))).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST" },
		});
		expect((await envelopeOf(s.id))?.status).toBe("in_progress");
		const done = await call(s.budget, "public/submit", good(s, { fieldValues: { phone: "0123" } }));
		expect(done).toMatchObject({ ok: true, status: "completed" });
		const signer = await runtime?.inspect.storage.get<Record<string, unknown>>("signers", `${s.id}:s1`);
		expect(signer?.fieldValues).toEqual({ phone: "0123" });
	});

	it("envelopes/create rejects malformed signerFields", async () => {
		process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
		runtime = await createPluginRuntimeTestHost();
		const budget = withBudget(runtime);
		const t = (await budget.invokeRoute("templates/create", { name: "W", body: BODY })).value as { template: { id: string } };
		const r = await budget.invokeRoute("envelopes/create", {
			templateId: t.template.id,
			signer: { name: "Ada", email: "ada@example.com" },
			fields: { event: "Gig" },
			signerFields: [{ key: "bad key", label: "x" }],
		});
		expect(r.value).toMatchObject({ ok: false });
	});
});
