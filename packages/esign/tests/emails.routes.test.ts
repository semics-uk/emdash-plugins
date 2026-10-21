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
import { pdfTaskName } from "../src/cron/pdf";
import { OUTBOX_TASK, outboxReport, runOutboxJob } from "../src/emails/outbox";

/** R22: target ≤ 8, hard limit 10. Send and the PDF job each gain one outbox write. */
const TARGET = { calls: 8, cpuMs: 50 };
const ONE_MORE = { calls: 9, cpuMs: 50 };
const LIMIT = { calls: 10, cpuMs: 50 };

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
	const t = (await budget.invokeRoute("templates/create", { name: "Waiver", body: BODY })).value as {
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
		expect((await outbox())[0]?.status).toBe("sent");
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
		expectWithinBudget(r, { calls: 1, cpuMs: 50 });
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
	it("delivery: email queues the invitation (one extra call) and never returns the token", async () => {
		const { budget, templateId } = await integration();
		const r = await call(
			budget,
			"public/envelopes/from-intent",
			{ intent: await intent(templateId, { delivery: "email" }) },
			LIMIT,
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
		await call(budget, "public/envelopes/from-intent", { intent: first }, LIMIT);
		await call(budget, "public/envelopes/from-intent", { intent: await intent(templateId, { delivery: "email" }) }, LIMIT);
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

		await call(budget, "public/session", { token });
		const snapshot = canonicalSnapshot(renderTemplate(BODY, { "signer.name": "Ada Lovelace", event: "Gig" }));
		const submitted = await call(
			budget,
			"public/submit",
			{
				token,
				consent: true,
				intent: true,
				docSha256: await sha256Hex(snapshot),
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
		expectWithinBudget(job, LIMIT);

		const rows = await outbox();
		expect(rows).toHaveLength(2);
		const done = rows.find((r) => r.message.subject.startsWith("Signed"));
		expect(done?.message.to).toBe("ada@example.com");
		expect(done?.message.text).toContain("https://site.test/_emdash/api/plugins/semics-esign/public/download?");
		expect(done?.message.text).not.toContain(token);
	});
});
