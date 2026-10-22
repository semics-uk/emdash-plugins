import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { canonicalSnapshot, hashToken, renderTemplate, sha256Hex } from "@semics-tech/shared";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";
import { pdfTaskName } from "../src/cron/pdf";
import {
	RETENTION_MORE_TASK,
	RETENTION_PAGE,
	RETENTION_STATE_KEY,
	RETENTION_TASK,
	type RetentionState,
} from "../src/cron/retention";
import {
	type AuditEventDoc,
	finalEnvelopeHash,
	initialAuditEvents,
	newPiiSalt,
	verifyAuditChain,
} from "../src/domain/audit";
import type { EnvelopeDoc, SignerDoc } from "../src/domain/envelopes";
import { DEFAULT_CONSENT_WORDING } from "../src/domain/signing";

// T097 (ES-FR-22, ES-NFR-06, R28, R45): the retention job purges personal data after the personal-data
// period and the signed record (PDF, snapshot, chain, signer) after the signed-records period, a page
// at a time inside the bridge budget. Never an open envelope, never one inside its period.

let runtime: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

/** R22: designs target 8 bridge calls per invocation. */
const TARGET = { calls: 8, cpuMs: 50 };
const SUBMIT = { calls: 9, cpuMs: 50 };
const DAY = 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const BODY = "# Waiver\n\nI, {{signer.name}}, accept the {{event}} terms.\n";
const TOKEN = "t".repeat(43);
const CONSENT_SHA256 = await sha256Hex(DEFAULT_CONSENT_WORDING);

type Row<T> = { id: string; data: T };
const host = () => runtime as PluginRuntimeTestHost;

async function setup() {
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost();
	const budget = withBudget(runtime);
	const t = (await budget.invokeRoute("templates/create", { name: "Waiver", body: BODY })).value as {
		template: { id: string };
	};
	return { r: runtime, budget, templateId: t.template.id };
}

/** A sent envelope whose signer token is TOKEN. */
async function sent(budget: BudgetedHost, templateId: string, email = "ada@example.com", token = TOKEN) {
	const created = (
		await budget.invokeRoute("envelopes/create", {
			templateId,
			signer: { name: "Ada Lovelace", email },
			fields: { event: "Gig" },
		})
	).value as { envelope: { id: string } };
	const id = created.envelope.id;
	await budget.invokeRoute("envelopes/send", { id });
	const signer = await host().inspect.storage.get<Record<string, unknown>>("signers", `${id}:s1`);
	await host().fixtures.plugin.storage("signers", `${id}:s1`, { ...signer, tokenHash: await hashToken(token) });
	return id;
}

/** Signs a sent envelope and stores its PDF; returns the `pdfSha256`. */
async function complete(budget: BudgetedHost, id: string): Promise<string> {
	const docSha256 = await sha256Hex(
		canonicalSnapshot(renderTemplate(BODY, { "signer.name": "Ada Lovelace", event: "Gig" })),
	);
	await budget.invokeRoute("public/session", { token: TOKEN, open: true });
	const submit = await budget.invokeRoute("public/submit", {
		token: TOKEN,
		consent: true,
		intent: true,
		docSha256,
		consentSha256: CONSENT_SHA256,
		signature: { kind: "typed", typedName: "Ada Lovelace" },
		fieldValues: {},
	});
	expectWithinBudget(submit, SUBMIT);
	await budget.invokeHook("cron", {
		name: pdfTaskName(id),
		data: { envelopeId: id, attempt: 0 },
		scheduledAt: iso(Date.now()),
	});
	const env = await envelopeOf(id);
	expect(env.pdfSha256, "PDF stored").toBeTruthy();
	return env.pdfSha256 as string;
}

const envelopeOf = async (id: string) =>
	(await host().inspect.storage.get<EnvelopeDoc>("envelopes", id)) as EnvelopeDoc;
const signerOf = async (id: string) => host().inspect.storage.get<SignerDoc>("signers", `${id}:s1`);
const eventsOf = async (id: string) =>
	((await host().inspect.storage.list<AuditEventDoc>("audit_events")) as Row<AuditEventDoc>[])
		.filter((e) => e.data.envelopeId === id)
		.map((e) => e.data)
		.sort((a, b) => a.seq - b.seq);
const artifactsOf = async (id: string) =>
	((await host().inspect.storage.list<{ envelopeId: string }>("artifacts")) as Row<{ envelopeId: string }>[]).filter(
		(a) => a.data.envelopeId === id,
	);

/** Moves an envelope back in time: created, sent and closed `ageMs` ago. */
async function age(id: string, ageMs: number, extra: Partial<EnvelopeDoc> = {}) {
	const env = await envelopeOf(id);
	const at = iso(Date.now() - ageMs);
	await host().fixtures.plugin.storage("envelopes", id, {
		...env,
		createdAt: iso(Date.now() - ageMs - DAY),
		updatedAt: at,
		...(env.sentAt ? { sentAt: at } : {}),
		...(env.completedAt ? { completedAt: at } : {}),
		...(env.closedAt ? { closedAt: at } : {}),
		...extra,
	});
}

const event = (name: string) => ({ name, scheduledAt: iso(Date.now()) });
const state = async () => (await host().inspect.kv.get<RetentionState>(RETENTION_STATE_KEY)) ?? {};

/** Runs the job (the recurring task, then its follow-ups) until the pass is idle; each tick in budget. */
async function runPass(budget: BudgetedHost, max = 40): Promise<number> {
	let ticks = 0;
	let name = RETENTION_TASK;
	do {
		const ran = await budget.invokeHook("cron", event(name));
		expectWithinBudget(ran, TARGET);
		ticks++;
		name = RETENTION_MORE_TASK;
	} while ((await state()).phase !== undefined && ticks < max);
	expect((await state()).phase, "the pass finished").toBeUndefined();
	return ticks;
}

const verify = (budget: BudgetedHost, sha256: string) =>
	budget.invokeRoute(
		"public/verify",
		{ sha256 },
		{ meta: { ip: "203.0.113.9", userAgent: null, referer: null, geo: null } },
	);

describe("ES-FR-22 retention job", () => {
	it("ES-NFR-06 chain verifies after purge, piiSalt is deleted and /verify still matches the signed PDF", async () => {
		const { budget, templateId } = await setup();
		const id = await sent(budget, templateId);
		const sha = await complete(budget, id);
		// Every copy of personal data the T034 review listed.
		await age(id, 400 * DAY, { returnUrl: "https://shop.example/done" });
		const signer = (await signerOf(id)) as SignerDoc;
		await host().fixtures.plugin.storage("signers", `${id}:s1`, {
			...signer,
			copyTokenHash: "c".repeat(64),
			ip: "203.0.113.9",
			ua: "UA",
			fieldValues: { phone: "0123" },
		});
		const before = await envelopeOf(id);
		expect((await eventsOf(id)).some((e) => e.personal !== null)).toBe(true);

		await runPass(budget);

		const env = await envelopeOf(id);
		expect(env).not.toHaveProperty("piiSalt");
		expect(env).not.toHaveProperty("returnUrl");
		expect(env.signer).toMatchObject({ name: "", email: "" });
		expect(env.fieldValues).toEqual({});
		expect(env.personalPurgedAt).toBeTruthy();
		// The signed record keeps its hashes.
		expect({ doc: env.docSha256, final: env.finalHash, pdf: env.pdfSha256 }).toEqual({
			doc: before.docSha256,
			final: before.finalHash,
			pdf: sha,
		});

		const s = (await signerOf(id)) as SignerDoc & Record<string, unknown>;
		expect(s.name).toBe("");
		expect(s.email).toBe("");
		for (const key of ["ip", "ua", "fieldValues", "declineReason", "copyTokenHash", "participant"]) {
			expect(s, key).not.toHaveProperty(key);
		}
		expect(s.tokenHash).not.toBe(await hashToken(TOKEN));
		expect(s.signature).toEqual({ kind: "typed", sha256: signer.signature?.sha256 });
		expect(s.status).toBe("signed");

		const events = await eventsOf(id);
		expect(events.every((e) => e.personal === null)).toBe(true);
		const chain = await verifyAuditChain(id, events);
		expect(chain.ok).toBe(true);
		if (chain.ok) expect(await finalEnvelopeHash(env.docSha256 as string, chain.value.head)).toBe(env.finalHash);

		// R45: within the signed-records period the PDF stays and /verify still matches it.
		expect((await artifactsOf(id)).length).toBeGreaterThan(0);
		expect((await verify(budget, sha)).value).toMatchObject({ matched: true, chainVerified: true });
		// The old signing token no longer opens anything.
		expect((await budget.invokeRoute("public/session", { token: TOKEN })).value).toMatchObject({ ok: false });
	});

	it("ES-FR-22 signed PDFs kept until their period ends, then the signed record goes and /verify no longer matches", async () => {
		const { budget, templateId } = await setup();
		const id = await sent(budget, templateId);
		const sha = await complete(budget, id);
		const pdfIds = (await envelopeOf(id)).pdf?.ids ?? [];
		const snapshotIds = (await envelopeOf(id)).snapshot?.ids ?? [];
		expect(pdfIds.length).toBeGreaterThan(0);

		// Past the personal-data period (12 months), inside the signed-records period (7 years).
		await age(id, 6 * 365 * DAY);
		await runPass(budget);
		expect((await artifactsOf(id)).map((a) => a.id).sort()).toEqual([...pdfIds].sort());
		expect((await verify(budget, sha)).value).toMatchObject({ matched: true });

		// The operator shortens the signed-records period to 5 years: now it has ended (dates only move
		// forward, so the pass resumes from the floor the previous pass left).
		await host().fixtures.plugin.setting("retentionSignedRecordsYears", 5);
		await runPass(budget);
		expect(await artifactsOf(id)).toEqual([]);
		for (const sid of snapshotIds) expect(await host().inspect.storage.get("snapshots", sid)).toBeNull();
		expect(await eventsOf(id)).toEqual([]);
		expect(await signerOf(id)).toBeNull();
		const tomb = await envelopeOf(id);
		expect(tomb).toMatchObject({
			status: "completed",
			title: "",
			pdfSha256: null,
			pdf: null,
			snapshot: null,
			signerIds: [],
		});
		expect(tomb.recordsPurgedAt).toBeTruthy();
		expect((await verify(budget, sha)).value).toEqual({ ok: true, matched: false });
	});

	it("ES-FR-22 never purges an open envelope or one still within its period", async () => {
		const { budget, templateId } = await setup();
		const open = await sent(budget, templateId, "open@example.com", "o".repeat(43));
		await age(open, 9 * 365 * DAY);
		// A second envelope, completed a month ago.
		const recent = await sent(budget, templateId, "recent@example.com");
		await complete(budget, recent);
		await age(recent, 30 * DAY);

		await runPass(budget);

		const o = await envelopeOf(open);
		expect(o.status).toBe("sent");
		expect(o.signer.email).toBe("open@example.com");
		expect(o.piiSalt).toBeTruthy();
		expect((await signerOf(open))?.email).toBe("open@example.com");
		expect((await eventsOf(open)).some((e) => e.personal !== null)).toBe(true);

		const r = await envelopeOf(recent);
		expect(r.signer.email).toBe("recent@example.com");
		expect(r.personalPurgedAt).toBeUndefined();
		expect((await artifactsOf(recent)).length).toBeGreaterThan(0);
	});

	it("ES-FR-22 a draft untouched for the whole personal-data period is deleted with its events", async () => {
		const { budget, templateId } = await setup();
		const created = (
			await budget.invokeRoute("envelopes/create", {
				templateId,
				signer: { name: "Ada Lovelace", email: "ada@example.com" },
				fields: { event: "Gig" },
			})
		).value as { envelope: { id: string } };
		const id = created.envelope.id;
		await age(id, 400 * DAY);
		await runPass(budget);
		expect(await host().inspect.storage.get("envelopes", id)).toBeNull();
		expect(await eventsOf(id)).toEqual([]);
	});

	it("ES-FR-22 purge resumable in batches: a keyset cursor in KV, at most 8 calls a tick, one-shot follow-ups", async () => {
		const { r, budget, templateId } = await setup();
		// 25 declined envelopes closed 400 days ago, 12 events each: several envelope pages, and audit
		// pages (100 events) that do not line up with them.
		const count = 25;
		const ids: string[] = [];
		for (let i = 0; i < count; i++) {
			const id = `env_batch_${String(i).padStart(3, "0")}`;
			ids.push(id);
			const at = iso(Date.now() - 400 * DAY);
			const created = iso(Date.now() - 401 * DAY + i * 1000);
			const salt = newPiiSalt();
			await r.fixtures.plugin.storage("envelopes", id, {
				title: "Waiver",
				templateId,
				templateVersion: 1,
				status: "declined",
				routing: "parallel",
				delivery: "email",
				signer: { name: `Signer ${i}`, email: `s${i}@example.com`, as: "self" },
				fieldValues: { event: "Gig" },
				signerIds: [`${id}:s1`],
				docSha256: "d".repeat(64),
				snapshot: null,
				expiresAt: null,
				sentAt: at,
				completedAt: null,
				closedAt: at,
				finalHash: null,
				piiSalt: salt,
				createdAt: created,
				updatedAt: at,
			});
			await r.fixtures.plugin.storage("signers", `${id}:s1`, {
				envelopeId: id,
				order: 1,
				role: "signer",
				name: `Signer ${i}`,
				email: `s${i}@example.com`,
				as: "self",
				status: "declined",
				tokenHash: `${String(i).padStart(4, "0")}${"f".repeat(60)}`,
				declineReason: "No thanks",
				ip: "198.51.100.7",
				createdAt: created,
			});
			const events = await initialAuditEvents(
				id,
				Array.from({ length: 12 }, (_, n) => ({
					type: n === 0 ? ("envelope.created" as const) : ("signer.viewed" as const),
					at,
					actor: "signer",
					personal: { ip: "198.51.100.7", email: `s${i}@example.com` },
				})),
				salt,
			);
			for (const e of events) await r.fixtures.plugin.storage("audit_events", e.id, e.data);
		}

		// Interrupted after three ticks: some pages done, the cursor saved in KV.
		await budget.invokeHook("cron", event(RETENTION_TASK));
		for (let i = 0; i < 2; i++) {
			const ran = await budget.invokeHook("cron", event(RETENTION_MORE_TASK));
			expectWithinBudget(ran, TARGET);
		}
		const mid = await state();
		expect(mid.phase).toBe("personal");
		expect((await r.inspect.scheduledTasks()).map((t) => t.name)).toContain(RETENTION_MORE_TASK);

		// The recurring task firing mid-pass resumes the same pass rather than restarting it.
		const ticks = await runPass(budget);
		expect(ticks).toBeLessThanOrEqual(4 * Math.ceil(count / RETENTION_PAGE) + 6);
		for (const id of ids) {
			const env = await envelopeOf(id);
			expect(env.personalPurgedAt, id).toBeTruthy();
			expect(env).not.toHaveProperty("piiSalt");
			const s = (await signerOf(id)) as SignerDoc;
			expect(s).toMatchObject({ name: "", email: "" });
			expect(s).not.toHaveProperty("declineReason");
			const events = await eventsOf(id);
			expect(events).toHaveLength(12);
			expect(events.every((e) => e.personal === null)).toBe(true);
			expect((await verifyAuditChain(id, events)).ok).toBe(true);
		}
		// The next pass starts from the floor and has nothing left to do.
		const again = await runPass(budget);
		expect(again).toBeLessThanOrEqual(5);
	});

	it("T100 deletes ended rate-limit counters (hashed IPs under a public salt; KV has no TTL), keeps live ones", async () => {
		const { r, budget } = await setup();
		const nowSec = Math.floor(Date.now() / 1000);
		for (let i = 0; i < 8; i++) await r.fixtures.plugin.kv(`rl:ceremony:h${i}:1`, `1:${nowSec - 60}`);
		await r.fixtures.plugin.kv("rl:verify:legacy:2", "7");
		await r.fixtures.plugin.kv("rl:ceremony:live:3", `2:${nowSec + 600}`);
		await runPass(budget);
		const keys = (await r.inspect.kv.list()).map((e) => e.id);
		expect(keys.filter((k) => k.startsWith("rl:"))).toEqual(["rl:ceremony:live:3"]);
	});

	it("ES-FR-22 deletes sent and failed outbox rows older than the period; pending and recent rows stay", async () => {
		const { r, budget } = await setup();
		const old = Date.now() - 400 * DAY;
		const row = (status: string, at: number) => ({
			message: { to: "ada@example.com", subject: "Sign", kind: "invite" },
			status,
			attempts: 1,
			nextAttemptAt: at,
			createdAt: at,
		});
		await r.fixtures.plugin.storage("outbox", "invite-old-sent", row("sent", old));
		await r.fixtures.plugin.storage("outbox", "invite-old-failed", row("failed", old));
		await r.fixtures.plugin.storage("outbox", "invite-old-pending", row("pending", old));
		await r.fixtures.plugin.storage("outbox", "invite-new-sent", row("sent", Date.now() - DAY));
		await runPass(budget);
		expect((await r.inspect.storage.list("outbox")).map((o) => o.id).sort()).toEqual([
			"invite-new-sent",
			"invite-old-pending",
		]);
	});
});

describe("ES-FR-22 deletion on request (admin)", () => {
	const click = (budget: BudgetedHost, action_id: string, value: string) =>
		budget.invokeRoute("admin", { type: "block_action", page: "/envelopes", action_id, value });

	it("ES-FR-22 by signer email: previews, then purges closed envelopes inside their period, keeps the signed record and open envelopes", async () => {
		const { budget, templateId } = await setup();
		const done = await sent(budget, templateId);
		const sha = await complete(budget, done);
		const open = await sent(budget, templateId, "ada@example.com", "o".repeat(43));

		const preview = await budget.invokeRoute("admin", {
			type: "form_submit",
			page: "/envelopes",
			action_id: "retention.preview",
			values: { subject: "ADA@example.com" },
		});
		expectWithinBudget(preview, TARGET);
		const shown = JSON.stringify(preview.value);
		expect(shown).toContain("retention.erase");
		expect(shown).toContain("1 envelope(s) to delete, 1 kept for now");

		const erased = await click(budget, "retention.erase", "ada@example.com");
		expectWithinBudget(erased, TARGET);
		expect(JSON.stringify(erased.value)).toContain("Personal data deleted");

		const env = await envelopeOf(done);
		expect(env.personalPurgedAt).toBeTruthy();
		expect(env).not.toHaveProperty("piiSalt");
		expect((await signerOf(done))?.email).toBe("");
		const events = await eventsOf(done);
		expect(events.every((e) => e.personal === null)).toBe(true);
		expect((await verifyAuditChain(done, events)).ok).toBe(true);
		expect((await artifactsOf(done)).length).toBeGreaterThan(0);
		expect((await verify(budget, sha)).value).toMatchObject({ matched: true, chainVerified: true });
		expect(await host().inspect.storage.get("outbox", `invite-${done}:s1`)).toBeNull();
		expect(await host().inspect.storage.get("outbox", `complete-${done}`)).toBeNull();

		// The open envelope keeps everything.
		expect((await envelopeOf(open)).signer.email).toBe("ada@example.com");
		expect((await signerOf(open))?.email).toBe("ada@example.com");
	});

	it("ES-FR-22 by envelope id; an unknown subject finds nothing", async () => {
		const { budget, templateId } = await setup();
		const id = await sent(budget, templateId);
		await complete(budget, id);
		const erased = await click(budget, "retention.erase", id);
		expectWithinBudget(erased, TARGET);
		expect((await envelopeOf(id)).personalPurgedAt).toBeTruthy();

		// Completed, but the signed PDF is not made yet: it needs the signer's details, so it waits.
		const pending = await sent(budget, templateId, "bob@example.com", "p".repeat(43));
		await budget.invokeRoute("public/session", { token: "p".repeat(43), open: true });
		const docSha256 = (await envelopeOf(pending)).docSha256;
		await budget.invokeRoute("public/submit", {
			token: "p".repeat(43),
			consent: true,
			intent: true,
			docSha256,
			consentSha256: CONSENT_SHA256,
			signature: { kind: "typed", typedName: "Bob" },
			fieldValues: {},
		});
		expect((await envelopeOf(pending)).status).toBe("completed");
		const waiting = await click(budget, "retention.erase", "bob@example.com");
		expect(JSON.stringify(waiting.value)).toContain("0 envelope(s) to delete, 1 kept for now");
		expect((await envelopeOf(pending)).personalPurgedAt).toBeUndefined();

		const none = await click(budget, "retention.erase", "nobody@example.com");
		expectWithinBudget(none, TARGET);
		expect(JSON.stringify(none.value)).toContain("No envelopes");
	});
});

describe("ES-FR-17 deletion on request finds drafts by signer email (T092)", () => {
	const erase = (budget: BudgetedHost, value: string) =>
		budget.invokeRoute("admin", { type: "block_action", page: "/envelopes", action_id: "retention.erase", value });

	it("ES-FR-17 a draft is found by its signer's email, though it has no signer document", async () => {
		const { budget, templateId } = await setup();
		const created = (
			await budget.invokeRoute("envelopes/create", {
				templateId,
				signer: { name: "Ada Lovelace", email: "Ada@Example.com" },
				fields: { event: "Gig" },
			})
		).value as { envelope: { id: string } };
		const id = created.envelope.id;
		const preview = await budget.invokeRoute("admin", {
			type: "form_submit",
			page: "/envelopes",
			action_id: "retention.preview",
			values: { subject: "ada@example.com" },
		});
		expectWithinBudget(preview, TARGET);
		expect(JSON.stringify(preview.value)).toContain("1 envelope(s) to delete");
		expectWithinBudget(await erase(budget, "ada@example.com"), TARGET);
		expect(await host().inspect.storage.get("envelopes", id)).toBeNull();
		expect(await eventsOf(id)).toEqual([]);
	});

	it("ES-FR-17 the lookup copy of the email is cleared with the rest of the personal data", async () => {
		const { budget, templateId } = await setup();
		const id = await sent(budget, templateId);
		expect((await envelopeOf(id)).signerEmail).toBe("ada@example.com");
		await budget.invokeRoute("envelopes/void", { id });
		expectWithinBudget(await erase(budget, id), TARGET);
		expect(await envelopeOf(id)).not.toHaveProperty("signerEmail");
	});
});
