import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";
import { EXPIRE_BATCH, EXPIRE_MORE_TASK, EXPIRE_TASK } from "../src/cron/expire";
import { type AuditEventDoc, verifyAuditChain } from "../src/domain/audit";
import type { EnvelopeDoc } from "../src/domain/envelopes";

// T092 (ES-FR-17): Free gives every unsigned envelope an end. The hourly `expire` task closes `sent` and
// `in_progress` envelopes whose `expiresAt` has passed, through the status machine, with an audited
// `envelope.expired` event, so retention (T097) can purge them. Automatic reminders are Pro.

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
const DAY = 86_400_000;
const host = () => runtime as PluginRuntimeTestHost;
const tick = (name: string) => ({ name, scheduledAt: new Date().toISOString() });

async function setup() {
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost();
	const budget = withBudget(runtime);
	const t = (await budget.invokeRoute("templates/create", { name: "Waiver", body: "# Waiver\n\nI accept {{event}}.\n" }))
		.value as { template: { id: string } };
	return { budget, templateId: t.template.id };
}

const envelopeOf = async (id: string) =>
	(await host().inspect.storage.get<EnvelopeDoc>("envelopes", id)) as EnvelopeDoc;

async function setExpiry(id: string, offset: number, patch: Partial<EnvelopeDoc> = {}) {
	await host().fixtures.plugin.storage("envelopes", id, {
		...(await envelopeOf(id)),
		...patch,
		expiresAt: new Date(Date.now() + offset).toISOString(),
	});
}

/** A sent envelope whose `expiresAt` is `offset` ms from now. */
async function sentEnvelope(budget: BudgetedHost, templateId: string, offset: number, email = "ada@example.com") {
	const created = (
		await budget.invokeRoute("envelopes/create", {
			templateId,
			signer: { name: "Ada Lovelace", email },
			fields: { event: "Gig" },
		})
	).value as { envelope: { id: string } };
	const id = created.envelope.id;
	await budget.invokeRoute("envelopes/send", { id });
	await setExpiry(id, offset);
	return id;
}

const eventsOf = async (id: string) =>
	((await host().inspect.storage.list<AuditEventDoc>("audit_events")) as Array<{ data: AuditEventDoc }>)
		.map((e) => e.data)
		.filter((e) => e.envelopeId === id)
		.sort((a, b) => a.seq - b.seq);

describe("ES-FR-17 expiry closes unsigned envelopes (Free)", () => {
	it("ES-FR-17 expires lapsed sent and in_progress envelopes with an audited envelope.expired, leaves the rest", async () => {
		const { budget, templateId } = await setup();
		const lapsed = await sentEnvelope(budget, templateId, -DAY);
		const viewed = await sentEnvelope(budget, templateId, -DAY, "bob@example.com");
		await setExpiry(viewed, -DAY, { status: "in_progress" });
		const fresh = await sentEnvelope(budget, templateId, 5 * DAY, "cy@example.com");
		const done = await sentEnvelope(budget, templateId, -DAY, "di@example.com");
		await setExpiry(done, -DAY, { status: "completed" });

		const ran = await budget.invokeHook("cron", tick(EXPIRE_TASK));
		expectWithinBudget(ran, TARGET);

		for (const id of [lapsed, viewed]) {
			const env = await envelopeOf(id);
			expect(env.status).toBe("expired");
			expect(env.closedAt).toBeTruthy();
			const events = await eventsOf(id);
			expect(events.at(-1)).toMatchObject({ type: "envelope.expired", actor: "system" });
			expect((await verifyAuditChain(id, events, { salt: env.piiSalt })).ok).toBe(true);
		}
		expect((await envelopeOf(fresh)).status).toBe("sent");
		expect((await envelopeOf(done)).status).toBe("completed");
		expect((await host().inspect.scheduledTasks()).map((t) => t.name)).not.toContain(EXPIRE_MORE_TASK);

		// Nothing due: one query.
		expectWithinBudget(await budget.invokeHook("cron", tick(EXPIRE_TASK)), { calls: 1, cpuMs: 50 });
	});

	it("ES-FR-17 a backlog is closed a few at a time, continued by a one-shot task", async () => {
		const { budget, templateId } = await setup();
		const ids: string[] = [];
		for (let i = 0; i < EXPIRE_BATCH + 1; i++) {
			ids.push(await sentEnvelope(budget, templateId, -DAY - i * 1000, `p${i}@example.com`));
		}
		expectWithinBudget(await budget.invokeHook("cron", tick(EXPIRE_TASK)), TARGET);
		const statuses = async () => Promise.all(ids.map(async (id) => (await envelopeOf(id)).status));
		expect((await statuses()).filter((s) => s === "expired")).toHaveLength(EXPIRE_BATCH);
		expect((await host().inspect.scheduledTasks()).map((t) => t.name)).toContain(EXPIRE_MORE_TASK);

		expectWithinBudget(await budget.invokeHook("cron", tick(EXPIRE_MORE_TASK)), TARGET);
		expect((await statuses()).every((s) => s === "expired")).toBe(true);
	});

	it("ES-FR-17 an expired envelope is terminal: it cannot be voided or signed afterwards", async () => {
		const { budget, templateId } = await setup();
		const id = await sentEnvelope(budget, templateId, -DAY);
		await budget.invokeHook("cron", tick(EXPIRE_TASK));
		expect((await envelopeOf(id)).status).toBe("expired");
		expect(JSON.stringify((await budget.invokeRoute("envelopes/void", { id })).value)).toContain("ENVELOPE_CLOSED");
	});
});
