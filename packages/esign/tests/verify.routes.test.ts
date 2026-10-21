import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { canonicalSnapshot, hashToken, renderTemplate, sha256Hex } from "@semics-tech/shared";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";
import { pdfTaskName } from "../src/cron/pdf";
import type { AuditEventDoc } from "../src/domain/audit";

/** R22: target ≤ 8 bridge calls; submit is at 9 since it schedules the PDF job (hard limit 10). */
const TARGET = { calls: 8, cpuMs: 50 };
const SUBMIT = { calls: 9, cpuMs: 50 };
const VERIFY = { calls: 8, cpuMs: 50 };

let runtime: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

const BODY = "# Waiver\n\nI, {{signer.name}}, accept the {{event}} terms.\n";
const TOKEN = "t".repeat(43);

type Body = Record<string, unknown> & { ok: boolean; error?: { code: string } };

interface Raw {
	status: number;
	headers: Array<[string, string]>;
	body: { kind: "bytes" | "text"; value: Uint8Array | string } | null;
}

interface Sent {
	budget: BudgetedHost;
	id: string;
	docSha256: string;
}

const host = () => runtime as PluginRuntimeTestHost;

async function call(budget: BudgetedHost, route: string, input: unknown, limit = TARGET): Promise<Body> {
	const r = await budget.invokeRoute(route, input);
	expectWithinBudget(r, limit);
	return r.value as Body;
}

/** A sent envelope whose signer token is known (the real token is only emailed, T027). */
async function sent(): Promise<Sent> {
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
		})
	).value as { envelope: { id: string } };
	const id = created.envelope.id;
	await budget.invokeRoute("envelopes/send", { id });
	const signer = await host().inspect.storage.get<Record<string, unknown>>("signers", `${id}:s1`);
	await host().fixtures.plugin.storage("signers", `${id}:s1`, { ...signer, tokenHash: await hashToken(TOKEN) });
	const snapshot = canonicalSnapshot(renderTemplate(BODY, { "signer.name": "Ada Lovelace", event: "Gig" }));
	return { budget, id, docSha256: await sha256Hex(snapshot) };
}

const submitBody = (s: Sent) => ({
	token: TOKEN,
	consent: true,
	intent: true,
	docSha256: s.docSha256,
	signature: { kind: "typed", typedName: "Ada Lovelace" },
});

const envelopeOf = async (id: string) =>
	(await host().inspect.storage.get<Record<string, unknown>>("envelopes", id)) as Record<string, unknown>;

/** A completed envelope whose signed PDF is stored; returns its `pdfSha256`. */
async function completed(s: Sent): Promise<string> {
	await call(s.budget, "public/session", { token: TOKEN });
	await call(s.budget, "public/submit", submitBody(s), SUBMIT);
	const job = await s.budget.invokeHook("cron", {
		name: pdfTaskName(s.id),
		data: { envelopeId: s.id, attempt: 0 },
		scheduledAt: new Date().toISOString(),
	});
	expectWithinBudget(job, TARGET);
	return (await envelopeOf(s.id)).pdfSha256 as string;
}

const verify = (s: Sent, sha256: unknown, ip = "203.0.113.9") =>
	s.budget.invokeRoute("public/verify", { sha256 }, { meta: { ip, userAgent: null, referer: null, geo: null } });

describe("ES-FR-09 public/verify", () => {
	it("a known hash is matched with status, completion time and a verified chain (within budget)", async () => {
		const s = await sent();
		const sha = await completed(s);
		const r = await verify(s, sha);
		expectWithinBudget(r, VERIFY);
		const env = await envelopeOf(s.id);
		expect(r.value).toEqual({
			ok: true,
			matched: true,
			status: "completed",
			completedAt: env.completedAt,
			finalHash: env.finalHash,
			chainVerified: true,
		});
	});

	it("is case-insensitive about the hash", async () => {
		const s = await sent();
		const sha = await completed(s);
		expect((await verify(s, sha.toUpperCase())).value).toMatchObject({ matched: true });
	});

	it("an unknown hash is not matched, and says nothing else", async () => {
		const s = await sent();
		await completed(s);
		const r = await verify(s, "a".repeat(64));
		expectWithinBudget(r, VERIFY);
		expect(r.value).toEqual({ ok: true, matched: false });
	});

	it("a malformed hash is BAD_REQUEST", async () => {
		const s = await sent();
		for (const bad of [undefined, 5, "xyz", "g".repeat(64), "a".repeat(63)]) {
			expect((await verify(s, bad)).value).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
		}
	});

	it("reports a tampered chain as not verified", async () => {
		const s = await sent();
		const sha = await completed(s);
		const events = await host().inspect.storage.list<AuditEventDoc>("audit_events");
		const last = events.at(-1) as unknown as { id: string; data: AuditEventDoc };
		await host().fixtures.plugin.storage("audit_events", last.id, { ...last.data, actor: "tampered" });
		expect((await verify(s, sha)).value).toMatchObject({ matched: true, chainVerified: false });
	});

	it("the response has no names, emails, salts, tokens or ip data", async () => {
		const s = await sent();
		const sha = await completed(s);
		const text = JSON.stringify((await verify(s, sha)).value);
		for (const secret of ["Ada", "ada@example.com", "203.0.113.9", TOKEN, "piiSalt", "tokenHash", s.id]) {
			expect(text).not.toContain(secret);
		}
	});

	it("is rate-limited per IP", async () => {
		const s = await sent();
		let last: unknown;
		for (let i = 0; i < 21; i++) last = (await verify(s, "b".repeat(64), "198.51.100.1")).value;
		expect(last).toMatchObject({ ok: false, error: { code: "RATE_LIMITED" } });
		expect((await verify(s, "b".repeat(64), "198.51.100.2")).value).toMatchObject({ ok: true, matched: false });
	});
});
