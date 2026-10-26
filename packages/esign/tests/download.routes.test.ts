import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { canonicalSnapshot, hashToken, renderTemplate, sha256Hex, signLink } from "@semics-tech/shared";
import { type BudgetedHost, type BudgetResult, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";
import { pdfTaskName } from "../src/cron/pdf";
import type { AuditEventDoc } from "../src/domain/audit";
import { MAX_DOCUMENT_BYTES, type SnapshotChunkDoc, snapshotChunks } from "../src/domain/envelopes";
import { ARTIFACT_CHUNK_CHARS, type ArtifactChunkDoc } from "../src/domain/pdf";
import { DEFAULT_CONSENT_WORDING } from "../src/domain/signing";
import { DOWNLOAD_PURPOSE, LINK_KEY } from "../src/routes/download";

/** The default consent wording's SHA-256, which a submit posts back (T117). */
const CONSENT_SHA256 = await sha256Hex(DEFAULT_CONSENT_WORDING);

/** R22: target ≤ 8 bridge calls; submit is at 9 since it schedules the PDF job (hard limit 10). */
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

const submitBody = (s: Sent, signature: unknown = { kind: "typed", typedName: "Ada Lovelace" }) => ({
	token: TOKEN,
	consent: true,
	intent: true,
	docSha256: s.docSha256,
	consentSha256: CONSENT_SHA256,
	signature,
});

async function signed(s: Sent, signature?: unknown): Promise<void> {
	await call(s.budget, "public/session", { token: TOKEN, open: true });
	const r = await call(s.budget, "public/submit", submitBody(s, signature), SUBMIT);
	expect(r).toMatchObject({ ok: true, status: "completed" });
}

async function runJob(budget: BudgetedHost, id: string, attempt = 0): Promise<BudgetResult> {
	const r = await budget.invokeHook("cron", {
		name: pdfTaskName(id),
		data: { envelopeId: id, attempt },
		scheduledAt: new Date().toISOString(),
	});
	expectWithinBudget(r, TARGET);
	return r;
}

const envelopeOf = async (id: string) =>
	(await host().inspect.storage.get<Record<string, unknown>>("envelopes", id)) as Record<string, unknown>;

const artifacts = async () => (await host().inspect.storage.list<ArtifactChunkDoc>("artifacts")).map((a) => a.data);

async function pdfTasks(id: string) {
	return (await host().inspect.scheduledTasks()).filter((t) => t.name === pdfTaskName(id));
}

/** The download link the signer gets from `public/session` once the PDF is stored. */
async function linkFromSession(budget: BudgetedHost): Promise<string> {
	const r = await call(budget, "public/session", { token: TOKEN });
	expect(r).toMatchObject({ ok: true, state: "closed", status: "completed", pdf: "ready" });
	return (r.download as { url: string }).url;
}

async function download(budget: BudgetedHost, url: string): Promise<Raw> {
	const r = await budget.invokeRoute(
		"public/download",
		{},
		{ url: new URL(url, "https://site.test").href, method: "GET" },
	);
	expectWithinBudget(r, TARGET);
	return r.value as Raw;
}

const bytesOf = (raw: Raw) => {
	expect(raw.body?.kind).toBe("bytes");
	expect(raw.body?.value).toBeInstanceOf(Uint8Array);
	return raw.body?.value as Uint8Array;
};

const errorOf = (raw: Raw) => {
	const value = raw.body?.value;
	return typeof value === "string" ? (JSON.parse(value) as Body).error?.code : undefined;
};

const header = (raw: Raw, name: string) => raw.headers.find(([k]) => k.toLowerCase() === name)?.[1];

describe("ES-FR-07 the signed PDF is built once, by a one-shot job at completion", () => {
	it("ES-FR-07 submit (9 calls) defers generation to the job, and the job completes it within budget", async () => {
		const s = await sent();
		await signed(s);
		expect(await artifacts()).toEqual([]);
		expect((await envelopeOf(s.id)).pdfSha256).toBeUndefined();
		expect(await pdfTasks(s.id)).toHaveLength(1);
		expect(await call(s.budget, "public/session", { token: TOKEN })).toMatchObject({
			state: "closed",
			status: "completed",
			pdf: "pending",
		});

		await runJob(s.budget, s.id);
		const env = await envelopeOf(s.id);
		expect(env.pdfSha256).toMatch(/^[0-9a-f]{64}$/);
		const chunks = await artifacts();
		expect(chunks.length).toBeGreaterThanOrEqual(1);
		expect(chunks.every((c) => c.sha256 === env.pdfSha256 && c.envelopeId === s.id)).toBe(true);
		expect((env.pdf as { ids: string[] }).ids).toHaveLength(chunks.length);

		// Run again (a duplicate tick): nothing is re-rendered or rewritten.
		const again = await runJob(s.budget, s.id);
		expect(again.calls.length).toBe(1);
		expect((await envelopeOf(s.id)).pdfSha256).toBe(env.pdfSha256);
	});

	it("ES-FR-07 the job re-arms itself while the chain does not yet end at finalHash", async () => {
		const s = await sent();
		await signed(s);
		const env = await envelopeOf(s.id);
		await host().fixtures.plugin.storage("envelopes", s.id, { ...env, finalHash: "0".repeat(64) });
		const before = (await pdfTasks(s.id))[0]?.nextRunAt;
		await runJob(s.budget, s.id);
		expect(await artifacts()).toEqual([]);
		const after = await pdfTasks(s.id);
		expect(after).toHaveLength(1);
		expect(after[0]?.nextRunAt).not.toBe(before);
		// After the last attempt it gives up instead of re-arming forever.
		await runJob(s.budget, s.id, 4);
		expect(await artifacts()).toEqual([]);
	});

	it("ES-FR-07 a job for an envelope that is not completed does nothing", async () => {
		const s = await sent();
		const r = await runJob(s.budget, s.id);
		expect(r.calls.length).toBe(1);
		expect(await artifacts()).toEqual([]);
	});
});

describe("ES-FR-08 public/download", () => {
	it("ES-FR-08 downloaded bytes hash to pdfSha256, and the link never carries the signing token", async () => {
		const s = await sent();
		const stroke = [
			[0.1, 0.5],
			[0.4, 0.2],
			[0.8, 0.6],
		];
		await signed(s, { kind: "drawn", strokes: [stroke] });
		await runJob(s.budget, s.id);
		const url = await linkFromSession(s.budget);
		expect(url).not.toContain(TOKEN);
		expect([...new URL(url, "https://x.test").searchParams.keys()].sort()).toEqual(["e", "exp", "sig"]);

		const raw = await download(s.budget, url);
		expect(raw.status).toBe(200);
		expect(header(raw, "content-type")).toBe("application/pdf");
		const bytes = bytesOf(raw);
		expect(await sha256Hex(bytes)).toBe((await envelopeOf(s.id)).pdfSha256);
		// The same stored bytes on every download.
		expect(await sha256Hex(bytesOf(await download(s.budget, url)))).toBe(await sha256Hex(bytes));

		// The admin view offers the same download.
		const got = await call(s.budget, "envelopes/get", { id: s.id });
		expect((got.download as { url: string }).url).toContain("/public/download?");
		expect(got.envelope).toMatchObject({ pdfSha256: (await envelopeOf(s.id)).pdfSha256 });
	});

	it("ES-FR-08 expired or altered links fail", async () => {
		const s = await sent();
		await signed(s);
		await runJob(s.budget, s.id);
		const url = new URL(await linkFromSession(s.budget), "https://site.test");
		const variant = (edit: (q: URLSearchParams) => void) => {
			const u = new URL(url.href);
			edit(u.searchParams);
			return u.href;
		};
		const code = async (href: string) => errorOf(await download(s.budget, href));

		expect(await code(variant((q) => q.set("sig", `${q.get("sig")?.slice(0, -2)}AA`)))).toBe("TOKEN_INVALID");
		expect(await code(variant((q) => q.set("e", "other")))).toBe("TOKEN_INVALID");
		expect(await code(variant((q) => q.set("exp", String(Number(q.get("exp")) + 3600))))).toBe("TOKEN_INVALID");
		expect(await code(variant((q) => q.delete("sig")))).toBe("TOKEN_INVALID");
		expect(await code(variant((q) => q.set("token", TOKEN)))).toBe("TOKEN_IN_QUERY");

		// A link signed with the real key, but over 15 minutes ago.
		const key = await host().inspect.kv.get<string>(LINK_KEY);
		const secret = Uint8Array.from((key as string).match(/../g) as string[], (h) => Number.parseInt(h, 16));
		const old = await signLink({ secret, purpose: DOWNLOAD_PURPOSE, params: { e: s.id }, now: Date.now() - 3_600_000 });
		expect(await code(`https://site.test${url.pathname}?${old}`)).toBe("TOKEN_EXPIRED");
		// A link for another purpose never opens a download.
		const other = await signLink({ secret, purpose: "esign/other", params: { e: s.id }, now: Date.now() });
		expect(await code(`https://site.test${url.pathname}?${other}`)).toBe("TOKEN_INVALID");
	});

	it("ES-FR-08 a completed envelope without its PDF yet is SIGNED_PDF_PENDING and re-arms the job", async () => {
		const s = await sent();
		await signed(s);
		await host().fixtures.plugin.kv(LINK_KEY, "ab".repeat(32));
		const secret = Uint8Array.from({ length: 32 }, () => 0xab);
		const link = await signLink({ secret, purpose: DOWNLOAD_PURPOSE, params: { e: s.id }, now: Date.now() });
		const raw = await download(s.budget, `/x?${link}`);
		expect(raw.status).toBe(409);
		expect(errorOf(raw)).toBe("SIGNED_PDF_PENDING");
		expect(await pdfTasks(s.id)).toHaveLength(1);
	});

	it("ES-FR-08 a large PDF round-trips through chunked storage", async () => {
		const s = await sent();
		// The largest document an envelope may hold (MAX_DOCUMENT_BYTES, T125): the cron renders,
		// hashes and chunks it inside the platform CPU budget, measured strictly on CI.
		const paragraph = "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor. "
			.repeat(2)
			.trim();
		const count = Math.floor((MAX_DOCUMENT_BYTES - 16) / (paragraph.length + 2));
		const text = canonicalSnapshot(`# Terms\n\n${Array.from({ length: count }, () => paragraph).join("\n\n")}`);
		expect(new TextEncoder().encode(text).length).toBeGreaterThan(MAX_DOCUMENT_BYTES - 200);
		expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_DOCUMENT_BYTES);
		const docSha256 = await sha256Hex(text);
		const chunks = snapshotChunks(s.id, text, docSha256);
		for (const c of chunks) await host().fixtures.plugin.storage("snapshots", c.id, c.data as SnapshotChunkDoc);
		const env = await envelopeOf(s.id);
		await host().fixtures.plugin.storage("envelopes", s.id, {
			...env,
			docSha256,
			snapshot: { ids: chunks.map((c) => c.id), length: text.length },
		});
		await signed({ ...s, docSha256 });

		await runJob(s.budget, s.id);
		const stored = await artifacts();
		expect(stored.length).toBeGreaterThan(1);
		expect(stored.every((c) => c.data.length <= ARTIFACT_CHUNK_CHARS)).toBe(true);
		const bytes = bytesOf(await download(s.budget, await linkFromSession(s.budget)));
		expect(bytes.length).toBeGreaterThan(256 * 1024);
		expect(await sha256Hex(bytes)).toBe((await envelopeOf(s.id)).pdfSha256);
	});

	it("ES-FR-08 the certificate in the stored PDF prints the audit head and the final hash", async () => {
		const s = await sent();
		await signed(s);
		await runJob(s.budget, s.id);
		const bytes = bytesOf(await download(s.budget, await linkFromSession(s.budget)));
		const text = Array.from(bytes, (b) => String.fromCharCode(b)).join("");
		const events = (await host().inspect.storage.list<AuditEventDoc>("audit_events"))
			.map((r) => r.data)
			.filter((e) => e.envelopeId === s.id);
		const head = events.sort((a, b) => b.seq - a.seq)[0]?.hash as string;
		expect(text).toContain(head);
		expect(text).toContain((await envelopeOf(s.id)).finalHash as string);
		for (const e of events) expect(text).toContain(e.type);
	});
});
