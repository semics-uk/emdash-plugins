import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import type { PluginContext } from "emdash/plugin";
import { afterEach, describe, expect, it } from "vitest";
import { handleAdmin } from "../src/admin/pages";
import type { AuditEventDoc } from "../src/domain/audit";

// The real plugin in workerd: the host validates every Block Kit response (ES-FR-11, ES-US-4).

let runtime: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

const BODY = "# Waiver\n\n{{signer.name}} agrees to attend {{event}}.\n";
const text = (res: { blocks?: unknown }) => JSON.stringify(res.blocks);
type Row<T> = { id: string; data: T };

async function setup() {
	runtime = await createPluginRuntimeTestHost();
	const r = runtime;
	const budget = withBudget(r);
	const created = (await budget.invokeRoute("templates/create", { name: "Waiver", body: BODY })).value as {
		template: { id: string };
	};
	return { r, budget, templateId: created.template.id };
}

/** Creates a draft through the admin form and returns its id. */
async function draft(r: PluginRuntimeTestHost, templateId: string): Promise<string> {
	const res = await r.admin.submit(
		"/envelopes",
		"envelope.create",
		{ title: "Gig waiver", signerName: "Ada Lovelace", signerEmail: "ada@example.com", "field:event": "Gig" },
		{ blockId: `envelope-new:${templateId}` },
	);
	expect(text(res)).toContain("Draft created");
	const rows = (await r.inspect.storage.list("envelopes")) as Row<{ status: string }>[];
	expect(rows).toHaveLength(1);
	return (rows[0] as Row<unknown>).id;
}

describe("ES-FR-11 admin pages in the host", () => {
	it("every page loads and validates", async () => {
		const { r } = await setup();
		for (const page of ["/envelopes", "/templates", "/settings"]) {
			const res = await r.admin.loadPage(page);
			expect(res.blocks?.length, page).toBeGreaterThan(0);
		}
	});

	it("ES-FR-01 a form submit creates a template and the list shows it", async () => {
		const { r } = await setup();
		const res = await r.admin.submit("/templates", "template.create", {
			name: "NDA",
			description: "Mutual",
			body: "Hello {{signer.name}}",
		});
		expect(text(res)).toContain("Template created");
		expect(text(res)).toContain("NDA");
		const rows = (await r.inspect.storage.list("templates")) as Row<{ name: string }>[];
		expect(rows.map((x) => x.data.name)).toContain("NDA");
		const bad = await r.admin.submit("/templates", "template.create", { name: "", body: "" });
		expect(text(bad)).toContain("Not saved");
	});

	it("ES-FR-01 the editor previews the body and saving writes a new version", async () => {
		const { r, templateId } = await setup();
		const open = await r.admin.act("/templates", "template.edit", { value: templateId });
		expect(text(open)).toContain("«event»");
		const saved = await r.admin.submit(
			"/templates",
			"template.save",
			{ name: "Waiver 2", description: "", body: `${BODY}Extra.` },
			{ blockId: `template:${templateId}` },
		);
		expect(text(saved)).toContain("Saved");
		const head = (await r.inspect.storage.get("templates", templateId)) as { version: number; name: string };
		expect(head).toMatchObject({ version: 2, name: "Waiver 2" });
	});

	it("ES-US-4 create, send, then the detail shows the audit events in order without secrets", async () => {
		const { r, templateId } = await setup();
		const form = await r.admin.act("/templates", "envelope.new", { value: templateId });
		expect(text(form)).toContain("field:event");
		const id = await draft(r, templateId);
		const sent = await r.admin.act("/envelopes", "envelope.send", { value: id });
		expect(text(sent)).toContain("Envelope sent");
		const out = text(await r.admin.act("/envelopes", "envelope.open", { value: id }));
		expect(out.indexOf("Envelope created")).toBeGreaterThan(-1);
		expect(out.indexOf("Envelope created")).toBeLessThan(out.indexOf("Envelope sent"));
		const signer = (await r.inspect.storage.get("signers", `${id}:s1`)) as { tokenHash: string };
		const envelope = (await r.inspect.storage.get("envelopes", id)) as { piiSalt: string };
		for (const secret of [signer.tokenHash, envelope.piiSalt, "tokenHash", "piiSalt"]) {
			expect(out).not.toContain(secret);
		}
		const list = await r.admin.submit("/envelopes", "envelopes.filter", { status: "sent" });
		expect(text(list)).toContain("Gig waiver");
		const none = await r.admin.submit("/envelopes", "envelopes.filter", { status: "completed" });
		expect(text(none)).not.toContain("Gig waiver");
	});

	it("ES-US-4 void closes the envelope through the status machine and records the event", async () => {
		const { r, templateId } = await setup();
		const id = await draft(r, templateId);
		await r.admin.act("/envelopes", "envelope.send", { value: id });
		const res = await r.admin.act("/envelopes", "envelope.void", { value: id });
		expect(text(res)).toContain("Voided");
		expect(((await r.inspect.storage.get("envelopes", id)) as { status: string }).status).toBe("voided");
		const events = ((await r.inspect.storage.list("audit_events")) as Row<AuditEventDoc>[]).map((e) => e.data.type);
		expect(events).toContain("envelope.voided");
		const again = await r.admin.act("/envelopes", "envelope.void", { value: id });
		expect(text(again)).toContain("cannot be voided");
	});

	it("T027 resend invitation is offered only when the invitation is not queued, and queues a fresh one", async () => {
		const { r, templateId } = await setup();
		const id = await draft(r, templateId);
		const sent = await r.admin.act("/envelopes", "envelope.send", { value: id });
		expect(text(sent)).not.toContain("Resend invitation");

		const row = (await r.inspect.storage.get("outbox", `invite-${id}:s1`)) as Record<string, unknown>;
		await r.fixtures.plugin.storage("outbox", `invite-${id}:s1`, { ...row, status: "failed" });
		const before = (await r.inspect.storage.get("signers", `${id}:s1`)) as { tokenHash: string };
		const detail = await r.admin.act("/envelopes", "envelope.open", { value: id });
		expect(text(detail)).toContain("Resend invitation");

		const resent = await r.admin.act("/envelopes", "envelope.resend", { value: id });
		expect(text(resent)).toContain("Invitation queued");
		expect(text(resent)).not.toContain("Resend invitation");
		const after = (await r.inspect.storage.get("signers", `${id}:s1`)) as { tokenHash: string };
		expect(after.tokenHash).not.toBe(before.tokenHash);
		const queued = (await r.inspect.storage.get("outbox", `invite-${id}:s1`)) as { status: string; message: unknown };
		expect(queued.status).toBe("pending");
		expect(JSON.stringify(queued.message)).toContain("/sign/");
		const token = /\/sign\/([A-Za-z0-9_-]+)/.exec(JSON.stringify(queued.message))?.[1] ?? "";
		expect(token.length).toBeGreaterThan(10);
		expect(text(resent)).not.toContain(token);
	});

	it("T027 resend repairs an envelope whose invitation never reached the outbox", async () => {
		const { r, templateId } = await setup();
		const id = await draft(r, templateId);
		await r.admin.act("/envelopes", "envelope.send", { value: id });
		// Rebuild the state `send` leaves when queueing throws: sent, signer stored, no outbox row, no `sent` event.
		const env = (await r.inspect.storage.get("envelopes", id)) as Record<string, unknown>;
		const signer = (await r.inspect.storage.get("signers", `${id}:s1`)) as Record<string, unknown>;
		const lone = "lone";
		await r.fixtures.plugin.storage("envelopes", lone, { ...env, signerIds: [`${lone}:s1`] });
		await r.fixtures.plugin.storage("signers", `${lone}:s1`, {
			...signer,
			envelopeId: lone,
			tokenHash: "f".repeat(64),
		});
		const detail = await r.admin.act("/envelopes", "envelope.open", { value: lone });
		expect(text(detail)).toContain("Resend invitation");
		const resent = await r.admin.act("/envelopes", "envelope.resend", { value: lone });
		expect(text(resent)).toContain("Invitation queued");
		expect(text(resent)).toContain("Envelope sent");
	});

	it("ES-FR-11 the outbox banner shows without a mail transport", async () => {
		const empty = { get: async () => null, query: async () => ({ items: [] }) };
		const ctx = { storage: { envelopes: empty, outbox: empty }, log: { error: () => {} } } as unknown as PluginContext;
		const res = await handleAdmin(
			{ ctx, origin: "http://localhost", now: 0 },
			{ type: "page_load", page: "/envelopes" },
		);
		expect(text(res)).toContain("No email transport");
	});

	it("T020 saving a secret without EMDASH_ENCRYPTION_KEY shows the encryption banner", async () => {
		delete process.env.EMDASH_ENCRYPTION_KEY;
		const { r } = await setup();
		const res = await r.admin.submit("/settings", "settings.save", {
			senderName: "Acme",
			integrationMasterKey: "master-key-for-tests-0123456789abcdef",
		});
		expect(text(res)).toContain("EMDASH_ENCRYPTION_KEY");
		expect(text(res)).not.toContain("master-key-for-tests");
		expect(await r.inspect.setting("integrationMasterKey")).toBeFalsy();
	});

	it("T020 settings save writes only what changed and never echoes a secret", async () => {
		process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
		const { r } = await setup();
		const res = await r.admin.submit("/settings", "settings.save", {
			senderName: "Acme Legal",
			expiryDays: 14,
			integrationMasterKey: "master-key-for-tests-0123456789abcdef",
		});
		expect(text(res)).toContain("Saved");
		expect(text(res)).not.toContain("master-key-for-tests");
		expect(await r.inspect.setting("senderName")).toBe("Acme Legal");
		expect(await r.inspect.setting("expiryDays")).toBe(14);
		const page = await r.admin.loadPage("/settings");
		expect(text(page)).not.toContain("master-key-for-tests");
		expect(text(page)).not.toContain("EMDASH_ENCRYPTION_KEY is not set");
	});

	it("ES-FR-11 admin actions stay within the bridge-call budget in the sandbox", async () => {
		const { r, budget, templateId } = await setup();
		const id = await draft(r, templateId);
		await r.admin.act("/envelopes", "envelope.send", { value: id });
		const row = (await r.inspect.storage.get("outbox", `invite-${id}:s1`)) as Record<string, unknown>;
		await r.fixtures.plugin.storage("outbox", `invite-${id}:s1`, { ...row, status: "failed" });
		const interactions = [
			{ type: "page_load", page: "/envelopes" },
			{ type: "page_load", page: "/templates" },
			{ type: "page_load", page: "/settings" },
			{ type: "block_action", action_id: "envelope.open", value: id },
			{ type: "form_submit", action_id: "envelopes.filter", values: { status: "sent" } },
			{ type: "block_action", action_id: "template.edit", value: templateId },
			{ type: "form_submit", action_id: "settings.save", values: { senderName: "A", expiryDays: 10 } },
			{ type: "block_action", action_id: "envelope.resend", value: id },
			{ type: "block_action", action_id: "envelope.void", value: id },
		];
		for (const i of interactions) {
			const res = await budget.invokeRoute("admin", i);
			expectWithinBudget(res, { calls: 8 });
		}
	});
});
