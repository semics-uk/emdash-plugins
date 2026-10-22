/**
 * T090 (ES-FR-15): an envelope with several signers in the Free core. Only E-sign Pro creates one, but a
 * site switched back to Free keeps it (BUILD-PLAN §13, R44 principle: a downgrade switches Pro features
 * off and never corrupts data). Free therefore records each signer's own view and decline, never
 * completes such an envelope (signing it is Pro routing, through the `ceremonyHandlers` seam), and its
 * signed-PDF job lists every signer.
 */
import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { hashToken, sha256Hex } from "@semics-tech/shared";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";
import {
	type AuditEventDoc,
	extendAuditChain,
	finalEnvelopeHash,
	verifyAuditChain,
} from "../src/domain/audit";
import { type ArtifactChunkDoc, joinPdf } from "../src/domain/pdf";
import { DEFAULT_CONSENT_WORDING } from "../src/domain/signing";

const LIMIT = { calls: 10, cpuMs: 50 };
const BODY = "I, {{signer.name}}, accept the terms.\n";
const T1 = "a".repeat(43);
const T2 = "b".repeat(43);
const CONSENT_SHA256 = await sha256Hex(DEFAULT_CONSENT_WORDING);

let runtime: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

type Body = Record<string, unknown> & { ok: boolean; error?: { code: string } };
type Doc = Record<string, unknown>;

const host = () => runtime as PluginRuntimeTestHost;
const envelopeOf = (id: string) => host().inspect.storage.get<Doc>("envelopes", id);
const signerOf = (id: string) => host().inspect.storage.get<Doc>("signers", id);

async function chain(id: string): Promise<AuditEventDoc[]> {
	const rows = await host().inspect.storage.list<AuditEventDoc>("audit_events");
	return rows
		.map((r) => r.data)
		.filter((e) => e.envelopeId === id)
		.sort((a, b) => a.seq - b.seq);
}

async function call(budget: BudgetedHost, route: string, input: unknown): Promise<Body> {
	const r = await budget.invokeRoute(route, input);
	expectWithinBudget(r, LIMIT);
	return r.value as Body;
}

/** A sent envelope turned into a two-signer one, as a Pro build leaves it; both tokens are known. */
async function twoSigners() {
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost();
	const budget = withBudget(runtime);
	const t = (await budget.invokeRoute("templates/create", { name: "Lease", body: BODY })).value as {
		template: { id: string };
	};
	const created = (
		await budget.invokeRoute("envelopes/create", {
			templateId: t.template.id,
			signer: { name: "Ada Lovelace", email: "ada@example.com" },
		})
	).value as { envelope: { id: string } };
	const id = created.envelope.id;
	await budget.invokeRoute("envelopes/send", { id });
	const s1 = (await signerOf(`${id}:s1`)) as Doc;
	await runtime.fixtures.plugin.storage("signers", `${id}:s1`, { ...s1, tokenHash: await hashToken(T1) });
	await runtime.fixtures.plugin.storage("signers", `${id}:s2`, {
		...s1,
		order: 2,
		name: "Grace Hopper",
		email: "grace@example.com",
		tokenHash: await hashToken(T2),
	});
	const envelope = (await envelopeOf(id)) as Doc;
	await runtime.fixtures.plugin.storage("envelopes", id, { ...envelope, signerIds: [`${id}:s1`, `${id}:s2`] });
	return { budget, id, docSha256: envelope.docSha256 as string };
}

const submitBody = (token: string, docSha256: string) => ({
	token,
	consent: true,
	intent: true,
	docSha256,
	consentSha256: CONSENT_SHA256,
	signature: { kind: "typed", typedName: "Ada Lovelace" },
});

describe("ES-FR-15 several signers in the Free core (T090)", () => {
	it("ES-FR-15 each signer's first view is their own signer.viewed event, recorded once", async () => {
		const { budget, id } = await twoSigners();
		expect(await call(budget, "public/session", { token: T1, open: true })).toMatchObject({
			state: "ready",
			signer: { name: "Ada Lovelace" },
		});
		expect((await envelopeOf(id))?.status).toBe("in_progress");
		expect(await call(budget, "public/session", { token: T2, open: true })).toMatchObject({
			state: "ready",
			signer: { name: "Grace Hopper" },
		});
		await call(budget, "public/session", { token: T2, open: true });
		const events = await chain(id);
		expect(events.map((e) => [e.type, e.data.signer])).toEqual([
			["envelope.created", undefined],
			["envelope.sent", undefined],
			["signer.viewed", 1],
			["signer.viewed", 2],
		]);
		expect(await verifyAuditChain(id, events, { salt: (await envelopeOf(id))?.piiSalt as string })).toMatchObject({
			ok: true,
		});
		expect(await signerOf(`${id}:s2`)).toMatchObject({ viewedAt: expect.any(String) });
	});

	it("ES-FR-15 R44 Free never completes a several-signer envelope: submit is ENVELOPE_CLOSED and writes nothing", async () => {
		const { budget, id, docSha256 } = await twoSigners();
		await call(budget, "public/session", { token: T1, open: true });
		const before = await chain(id);
		expect(await call(budget, "public/submit", submitBody(T1, docSha256))).toMatchObject({
			ok: false,
			error: { code: "ENVELOPE_CLOSED" },
		});
		expect(await chain(id)).toEqual(before);
		expect(await envelopeOf(id)).toMatchObject({ status: "in_progress", finalHash: null });
		expect(await signerOf(`${id}:s1`)).toMatchObject({ status: "pending" });
		expect((await signerOf(`${id}:s1`))?.signature).toBeUndefined();
	});

	it("ES-FR-15 a signer who has signed sees the envelope still open while the others sign", async () => {
		const { budget, id } = await twoSigners();
		await call(budget, "public/session", { token: T1, open: true });
		const s1 = (await signerOf(`${id}:s1`)) as Doc;
		await host().fixtures.plugin.storage("signers", `${id}:s1`, { ...s1, status: "signed" });
		expect(await call(budget, "public/session", { token: T1 })).toMatchObject({
			ok: true,
			state: "closed",
			status: "in_progress",
		});
	});

	it("ES-FR-15 a decline by any signer closes the envelope and names that signer in the chain", async () => {
		const { budget, id } = await twoSigners();
		await call(budget, "public/session", { token: T1, open: true });
		expect(await call(budget, "public/decline", { token: T2 })).toMatchObject({ ok: true, status: "declined" });
		expect((await envelopeOf(id))?.status).toBe("declined");
		const events = await chain(id);
		expect(events.slice(-2).map((e) => [e.type, e.data.signer])).toEqual([
			["signer.declined", 2],
			["envelope.declined", undefined],
		]);
		expect(await call(budget, "public/submit", submitBody(T1, "d".repeat(64)))).toMatchObject({ ok: false });
	});

	it("ES-FR-15 the signed PDF job renders every signer and certifies each one's signature", async () => {
		const { budget, id } = await twoSigners();
		const envelope = (await envelopeOf(id)) as Doc;
		const salt = envelope.piiSalt as string;
		const at = new Date().toISOString();
		const signed = (n: number, name: string) => ({
			status: "signed",
			signedAt: at,
			consentAt: at,
			consentVersion: "1",
			consentSha256: CONSENT_SHA256,
			signature: { kind: "typed", typedName: name, sha256: String(n).repeat(64) },
			ip: `203.0.113.${n}`,
		});
		for (const [n, name] of [
			[1, "Ada Lovelace"],
			[2, "Grace Hopper"],
		] as const) {
			const doc = (await signerOf(`${id}:s${n}`)) as Doc;
			await host().fixtures.plugin.storage("signers", `${id}:s${n}`, { ...doc, ...signed(n, name) });
		}
		const opening = await chain(id);
		const more = await extendAuditChain(
			id,
			opening.at(-1) ?? null,
			[
				{ type: "signer.signed", at, actor: "signer", data: { signer: 1 }, personal: { ip: "203.0.113.1" } },
				{ type: "signer.signed", at, actor: "signer", data: { signer: 2 }, personal: { ip: "203.0.113.2" } },
				{ type: "envelope.completed", at, actor: "system", data: {} },
			],
			salt,
		);
		for (const e of more) await host().fixtures.plugin.storage("audit_events", e.id, e.data);
		const head = more.at(-1)?.data.hash as string;
		await host().fixtures.plugin.storage("envelopes", id, {
			...envelope,
			status: "completed",
			completedAt: at,
			finalHash: await finalEnvelopeHash(envelope.docSha256 as string, head),
		});

		const job = await budget.invokeHook("cron", {
			name: `signed-pdf-${id}`,
			data: { envelopeId: id, attempt: 0 },
			scheduledAt: at,
		});
		expectWithinBudget(job, { calls: 8, cpuMs: 50 });
		const stored = await envelopeOf(id);
		expect(typeof stored?.pdfSha256).toBe("string");
		const chunks = (await host().inspect.storage.list<ArtifactChunkDoc>("artifacts")).map((a) => a.data);
		const pdf = joinPdf(chunks) as Uint8Array;
		const text = Array.from(pdf, (b) => String.fromCharCode(b)).join("");
		for (const fact of ["Ada Lovelace", "Grace Hopper", "1".repeat(64), "2".repeat(64), "Signer 1", "Signer 2"]) {
			expect(text).toContain(fact);
		}
		expect(text).toContain("signer 2");
	});
});
