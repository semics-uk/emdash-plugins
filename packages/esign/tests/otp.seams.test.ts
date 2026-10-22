/**
 * T091 (ES-FR-16): what the Free core knows about an email one-time code, which only E-sign Pro issues.
 * An envelope may carry `otp: true`; a signer who has not verified (`otpVerifiedAt`) cannot sign it,
 * and the session says so. A downgrade therefore never opens a hole: Free keeps refusing. (The
 * `onEnvelopeSend` seam runs in the sandbox bundle, so E-sign Pro's editions tests cover it.)
 */
import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { hashToken, sha256Hex } from "@semics-tech/shared";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONSENT_WORDING } from "../src/domain/signing";

const LIMIT = { calls: 10, cpuMs: 50 };
const TOKEN = "a".repeat(43);
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

async function call(budget: BudgetedHost, route: string, input: unknown): Promise<Body> {
	const r = await budget.invokeRoute(route, input);
	expectWithinBudget(r, LIMIT);
	return r.value as Body;
}

async function draft() {
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost();
	const budget = withBudget(runtime);
	const t = (await call(budget, "templates/create", {
		name: "Lease",
		body: "I, {{signer.name}}, accept.\n",
	})) as Body & {
		template: { id: string };
	};
	const created = (await call(budget, "envelopes/create", {
		templateId: t.template.id,
		signer: { name: "Ada Lovelace", email: "ada@example.com" },
	})) as Body & { envelope: { id: string } };
	return { budget, id: created.envelope.id };
}

/** A sent envelope whose signer's token is known. */
async function sentEnvelope(otp: boolean) {
	const { budget, id } = await draft();
	await call(budget, "envelopes/send", { id });
	const signerId = `${id}:s1`;
	const signer = (await host().inspect.storage.get<Doc>("signers", signerId)) as Doc;
	const withToken = { ...signer, tokenHash: await hashToken(TOKEN) };
	await host().fixtures.plugin.storage("signers", signerId, withToken);
	const envelope = (await host().inspect.storage.get<Doc>("envelopes", id)) as Doc;
	if (otp) await host().fixtures.plugin.storage("envelopes", id, { ...envelope, otp: true });
	return { budget, id, signerId, signer: withToken, docSha256: envelope.docSha256 as string };
}

const submitBody = (docSha256: string) => ({
	token: TOKEN,
	consent: true,
	intent: true,
	docSha256,
	consentSha256: CONSENT_SHA256,
	signature: { kind: "typed", typedName: "Ada Lovelace" },
});

describe("ES-FR-16 an envelope that needs an email code", () => {
	it("ES-FR-16 the session says a code is required, then that it is verified", async () => {
		const { budget, signerId, signer } = await sentEnvelope(true);
		expect(await call(budget, "public/session", { token: TOKEN, open: true })).toMatchObject({
			state: "ready",
			otp: "required",
		});
		await host().fixtures.plugin.storage("signers", signerId, { ...signer, otpVerifiedAt: "2026-10-21T10:00:00.000Z" });
		expect(await call(budget, "public/session", { token: TOKEN })).toMatchObject({ state: "ready", otp: "verified" });
	});

	it("ES-FR-16 an envelope without the flag shows no otp field", async () => {
		const { budget } = await sentEnvelope(false);
		expect(await call(budget, "public/session", { token: TOKEN })).not.toHaveProperty("otp");
	});

	it("ES-FR-16 submit without a verified code is OTP_REQUIRED and writes nothing", async () => {
		const { budget, id, signerId, docSha256 } = await sentEnvelope(true);
		await call(budget, "public/session", { token: TOKEN, open: true });
		const events = await host().inspect.storage.list("audit_events");
		expect(await call(budget, "public/submit", submitBody(docSha256))).toMatchObject({
			ok: false,
			error: { code: "OTP_REQUIRED" },
		});
		expect(await host().inspect.storage.list("audit_events")).toHaveLength(events.length);
		expect(await host().inspect.storage.get<Doc>("signers", signerId)).toMatchObject({ status: "pending" });
		expect(await host().inspect.storage.get<Doc>("envelopes", id)).toMatchObject({ status: "in_progress" });
	});

	it("ES-FR-16 a verified signer signs, and submit stays within the call budget", async () => {
		const { budget, id, signerId, signer, docSha256 } = await sentEnvelope(true);
		await call(budget, "public/session", { token: TOKEN, open: true });
		await host().fixtures.plugin.storage("signers", signerId, { ...signer, otpVerifiedAt: "2026-10-21T10:00:00.000Z" });
		expect(await call(budget, "public/submit", submitBody(docSha256))).toMatchObject({ ok: true, status: "completed" });
		expect(await host().inspect.storage.get<Doc>("envelopes", id)).toMatchObject({ status: "completed" });
	});
});
