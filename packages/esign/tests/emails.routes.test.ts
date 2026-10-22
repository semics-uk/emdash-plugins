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
import { completionTaskName } from "../src/cron/completion-email";
import { pdfTaskName } from "../src/cron/pdf";
import { DEFAULT_CONSENT_WORDING } from "../src/domain/signing";
import { OUTBOX_TASK, outboxReport, runOutboxJob } from "../src/emails/outbox";

/** The default consent wording's SHA-256, which a submit posts back (T117). */
const CONSENT_SHA256 = await sha256Hex(DEFAULT_CONSENT_WORDING);

/** R22: target ≤ 8, hard limit 10. Send and the PDF job each gain one outbox write. */
const TARGET = { calls: 8, cpuMs: 50 };
const ONE_MORE = { calls: 9, cpuMs: 50 };

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

type Body = Record<string, unknown> & { ok: boolean };
interface OutboxRow {
	message: { to: string; subject: string; text: string; html?: string };
	status: string;
}

const host = () => runtime as PluginRuntimeTestHost;

async function setup(): Promise<{ budget: BudgetedHost; templateId: string }> {
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost({ site: { name: "Acme Theatre", url: "https://site.test" } });
	const budget = withBudget(runtime);
	const t = (await budget.invokeRoute("templates/create", { name: "Waiver", body: BODY, integrations: true }))
		.value as {
		template: { id: string };
	};
	return { budget, templateId: t.template.id };
}

async function call(budget: BudgetedHost, route: string, input: unknown, limit = TARGET): Promise<Body> {
	const r = await budget.invokeRoute(route, input);
	expectWithinBudget(r, limit);
	return r.value as Body;
}

const outbox = async () => (await host().inspect.storage.list<OutboxRow>("outbox")).map((r) => r.data);

async function createEnvelope(budget: BudgetedHost, templateId: string): Promise<string> {
	const created = await call(budget, "envelopes/create", {
		templateId,
		signer: { name: "Ada Lovelace", email: "ada@example.com" },
		fields: { event: "Gig" },
	});
	return (created.envelope as { id: string }).id;
}

const tokenIn = (text: string) => /\/sign\/([A-Za-z0-9_-]+)/.exec(text)?.[1] as string;

async function drain(budget: BudgetedHost) {
	const r = await budget.invokeHook("cron", { name: OUTBOX_TASK, scheduledAt: new Date().toISOString() });
	expectWithinBudget(r, TARGET);
}

describe("ES-FR-10 invitation emails", () => {
	it("envelopes/send queues one invitation with the working signing link, and the drain sends it", async () => {
		const { budget, templateId } = await setup();
		const id = await createEnvelope(budget, templateId);
		const sent = await call(budget, "envelopes/send", { id }, ONE_MORE);
		expect(sent.ok).toBe(true);
		expect(JSON.stringify(sent)).not.toMatch(/\/sign\//);

		const rows = await outbox();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("pending");
		const message = rows[0]?.message;
		expect(message?.to).toBe("ada@example.com");
		expect(message?.subject).toBe("Acme Theatre asks you to sign: Waiver");
		expect(message?.text).toContain("https://site.test/sign/");

		// The emailed token is the one whose hash is stored.
		const signer = await host().inspect.storage.get<{ tokenHash: string }>("signers", `${id}:s1`);
		expect(await hashToken(tokenIn(message?.text ?? ""))).toBe(signer?.tokenHash);

		await drain(budget);
		const mail = await host().inspect.email();
		expect(mail).toHaveLength(1);
		expect(mail[0]).toMatchObject({ to: "ada@example.com" });
		const [row] = await outbox();
		expect(row?.status).toBe("sent");
		// R32: the sent row no longer holds the clear-text signing token.
		expect(row?.message).toEqual({ to: "ada@example.com", subject: "Acme Theatre asks you to sign: Waiver" });
		expect(JSON.stringify(row)).not.toContain(tokenIn(message?.text ?? ""));
	});

	it("a second send of the same envelope queues nothing more", async () => {
		const { budget, templateId } = await setup();
		const id = await createEnvelope(budget, templateId);
		await call(budget, "envelopes/send", { id }, ONE_MORE);
		const again = await call(budget, "envelopes/send", { id });
		expect(again.ok).toBe(false);
		expect(await outbox()).toHaveLength(1);
	});

	it("a drain tick with an empty outbox is one call", async () => {
		const { budget } = await setup();
		const r = await budget.invokeHook("cron", { name: OUTBOX_TASK, scheduledAt: new Date().toISOString() });
		expectWithinBudget(r, { calls: 1, cpuMs: 50 });
	});

	it("the recurring drain is scheduled on activation", async () => {
		const { budget } = await setup();
		const r = await budget.invokeHook("plugin:activate", {});
		// One schedule call per recurring task: the drain, (T061) the nonce sweep and (T097) retention and (T092) expiry.
		expectWithinBudget(r, { calls: 4, cpuMs: 50 });
		const names = (await host().inspect.scheduledTasks()).map((t) => t.name);
		expect(names).toContain(OUTBOX_TASK);
	});

	it("no transport: the admin banner state is reported", async () => {
		const { budget, templateId } = await setup();
		const id = await createEnvelope(budget, templateId);
		await call(budget, "envelopes/send", { id }, ONE_MORE);
		const status = await call(budget, "outbox/status", {});
		expect(status).toMatchObject({ ok: true, pending: 1, failed: 0 });
		expect(status.state).toBe("ok"); // the test host has a transport
	});

	it("no transport: the report says so, and a drain sends nothing and leaves mail pending", async () => {
		const rows = new Map<string, OutboxRow>([
			["a", { message: { to: "a@x.test", subject: "s", text: "t" }, status: "pending" }],
		]);
		const ctx = {
			email: undefined,
			storage: {
				outbox: {
					put: async () => {},
					putMany: async () => {},
					query: async (o: { where?: { status?: string } }) => ({
						items: [...rows].filter(([, r]) => r.status === o.where?.status).map(([id, data]) => ({ id, data })),
					}),
				},
			},
			log: { error: () => {} },
		} as unknown as Parameters<typeof outboxReport>[0];
		expect(await outboxReport(ctx)).toEqual({ state: "no_transport", pending: 1, failed: 0 });
		expect(await runOutboxJob({ name: OUTBOX_TASK, scheduledAt: "" }, ctx)).toBe(true);
		expect(await runOutboxJob({ name: "other", scheduledAt: "" }, ctx)).toBe(false);
	});
});

// --- from-intent with delivery: "email" ---

const NOW_S = () => Math.floor(Date.now() / 1000);
let nonceSeq = 0;
async function intent(templateId: string, over: Partial<IntentPayload> = {}): Promise<string> {
	nonceSeq++;
	const p: IntentPayload = {
		v: 1,
		typ: "intent",
		cid: CID,
		iat: NOW_S(),
		exp: NOW_S() + 600,
		nonce: `mail${String(nonceSeq).padStart(17, "0")}`,
		tpl: templateId,
		ref: "BK7Q2M:A1",
		signer: { name: "Ada Lovelace", email: "ada@example.com" },
		prefill: { event: "Gig" },
		returnUrl: "https://events.example/booking/BK7Q2M",
		...over,
	};
	return signEsignToken("intent", p, await deriveClientSecret(new TextEncoder().encode(MASTER), CID));
}

async function integration() {
	const s = await setup();
	await host().actions.plugin.updateSettings({ integrationMasterKey: MASTER, senderName: "Box Office" });
	await host().fixtures.plugin.storage("clients", CID, {
		name: "Events",
		clientId: CID,
		createdAt: "2026-10-01T00:00:00.000Z",
		revokedAt: null,
		returnUrlAllowlist: ["https://events.example/booking"],
	});
	return s;
}

describe("ES-FR-10 from-intent delivery", () => {
	it("delivery: email queues the invitation, never returns the token and stays at 9 calls", async () => {
		const { budget, templateId } = await integration();
		const r = await call(
			budget,
			"public/envelopes/from-intent",
			{ intent: await intent(templateId, { delivery: "email" }) },
			ONE_MORE,
		);
		expect(Object.keys(r).sort()).toEqual(["envelopeId", "ok", "status"]);
		const rows = await outbox();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.message.subject).toBe("Box Office asks you to sign: Waiver");
		const signer = await host().inspect.storage.get<{ tokenHash: string }>("signers", `${r.envelopeId}:s1`);
		expect(await hashToken(tokenIn(rows[0]?.message.text ?? ""))).toBe(signer?.tokenHash);
	});

	it("delivery: inline queues nothing and stays at 9 calls", async () => {
		const { budget, templateId } = await integration();
		const r = await call(budget, "public/envelopes/from-intent", { intent: await intent(templateId) }, ONE_MORE);
		expect(r.signingToken).toBeTypeOf("string");
		expect(await outbox()).toHaveLength(0);
	});

	it("an idempotent replay of an email intent queues no second invitation", async () => {
		const { budget, templateId } = await integration();
		const first = await intent(templateId, { delivery: "email" });
		await call(budget, "public/envelopes/from-intent", { intent: first }, ONE_MORE);
		await call(
			budget,
			"public/envelopes/from-intent",
			{ intent: await intent(templateId, { delivery: "email" }) },
			ONE_MORE,
		);
		expect(await outbox()).toHaveLength(1);
	});
});

// --- completion ---

describe("ES-FR-10 completion email", () => {
	it("the PDF job queues the download email with an absolute signed link", async () => {
		const { budget, templateId } = await setup();
		const id = await createEnvelope(budget, templateId);
		await call(budget, "envelopes/send", { id }, ONE_MORE);
		const token = tokenIn((await outbox())[0]?.message.text ?? "");

		await call(budget, "public/session", { token, open: true });
		const snapshot = canonicalSnapshot(renderTemplate(BODY, { "signer.name": "Ada Lovelace", event: "Gig" }));
		const submitted = await call(
			budget,
			"public/submit",
			{
				token,
				consent: true,
				intent: true,
				docSha256: await sha256Hex(snapshot),
				consentSha256: CONSENT_SHA256,
				signature: { kind: "typed", typedName: "Ada Lovelace" },
			},
			ONE_MORE,
		);
		expect(submitted).toMatchObject({ ok: true, status: "completed" });
		expect(await outbox()).toHaveLength(1); // submit itself queues nothing

		const job = await budget.invokeHook("cron", {
			name: pdfTaskName(id),
			data: { envelopeId: id, attempt: 0 },
			scheduledAt: new Date().toISOString(),
		});
		expectWithinBudget(job, TARGET);
		const mailTask = await budget.invokeHook("cron", {
			name: completionTaskName(id),
			data: { envelopeId: id },
			scheduledAt: new Date().toISOString(),
		});
		expectWithinBudget(mailTask, TARGET);

		const rows = await outbox();
		expect(rows).toHaveLength(2);
		const done = rows.find((r) => r.message.subject.startsWith("Signed"));
		expect(done?.message.to).toBe("ada@example.com");
		// The email links the stable page, not the 15-minute download link, with a fresh token in its path.
		const fresh = /https:\/\/site\.test\/signed\/([A-Za-z0-9_-]+)/.exec(done?.message.text ?? "")?.[1] as string;
		expect(fresh).toBeTruthy();
		expect(fresh).not.toBe(token);
		expect(done?.message.text).not.toContain("public/download");
		expect(done?.message.html).toContain(`/signed/${fresh}`);
		// R36/T115: the signing token is not rotated, so the sign page's poll still gets the link.
		expect(await call(budget, "public/session", { token })).toMatchObject({
			ok: true,
			state: "closed",
			status: "completed",
			pdf: "ready",
			download: { url: expect.stringContaining("public/download?") },
		});
		// The emailed copy token (its own credential) yields a fresh download link, within budget.
		expect(await call(budget, "public/session", { token: fresh })).toMatchObject({
			ok: true,
			status: "completed",
			pdf: "ready",
			download: { url: expect.stringContaining("public/download?") },
		});
		// Only the copy token's hash is stored, beside the signing token's.
		const signer = (await host().inspect.storage.list<{ tokenHash: string; copyTokenHash?: string }>("signers"))[0]
			?.data;
		expect(signer?.tokenHash).toBe(await hashToken(token));
		expect(signer?.copyTokenHash).toBe(await hashToken(fresh));
		// Re-running the job once the email is queued mints no second copy token.
		const again = await budget.invokeHook("cron", {
			name: completionTaskName(id),
			data: { envelopeId: id },
			scheduledAt: new Date().toISOString(),
		});
		expectWithinBudget(again, TARGET);
		expect(await outbox()).toHaveLength(2);
		const after = (await host().inspect.storage.list<{ copyTokenHash?: string }>("signers"))[0]?.data;
		expect(after?.copyTokenHash).toBe(signer?.copyTokenHash);
	});

	it("a copy token opens no session for a non-completed envelope and cannot submit", async () => {
		const { budget, templateId } = await setup();
		const id = await createEnvelope(budget, templateId);
		await call(budget, "envelopes/send", { id }, ONE_MORE);
		const copy = "C".repeat(43);
		// Plant a copy hash on the signer of a sent (not completed) envelope.
		const [row] = await host().inspect.storage.list<Record<string, unknown>>("signers");
		await host().fixtures.plugin.storage("signers", row?.id as string, {
			...row?.data,
			copyTokenHash: await hashToken(copy),
		});
		expect(await call(budget, "public/session", { token: copy })).toMatchObject({ ok: false });
		const submit = await call(
			budget,
			"public/submit",
			{
				token: copy,
				consent: true,
				intent: true,
				docSha256: "x",
				signature: { kind: "typed", typedName: "Ada Lovelace" },
			},
			ONE_MORE,
		);
		expect(submit).toMatchObject({ ok: false });
		expect((await host().inspect.storage.list<{ status: string }>("envelopes"))[0]?.data.status).toBe("sent");
	});
});
