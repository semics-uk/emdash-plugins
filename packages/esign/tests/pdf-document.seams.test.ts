/**
 * T094 (ES-FR-19): what the Free core knows about an uploaded-PDF envelope, which only E-sign Pro sends and
 * stamps. Such an envelope has no text snapshot (`snapshot: null`); its document is the uploaded PDF, whose
 * SHA-256 is `docSha256`, described by `document` (`kind: "pdf"`, file name, size, pages; Pro keeps where the
 * bytes are and the field layout there too). Free shows the signer what it is, never Pro's storage details,
 * and refuses to sign it: Free cannot show or stamp the PDF, so a site switched back to Free leaves such an
 * envelope waiting for Pro, as it does an envelope with several signers (T090).
 */
import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { hashToken, sha256Hex } from "@semics-tech/shared";
import { type BudgetedHost, expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_CONSENT_WORDING } from "../src/domain/signing";

const LIMIT = { calls: 10, cpuMs: 50 };
const TOKEN = "p".repeat(43);
const CONSENT_SHA256 = await sha256Hex(DEFAULT_CONSENT_WORDING);
const PDF_SHA256 = "d".repeat(64);

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

async function call(budget: BudgetedHost, route: string, input: unknown) {
	const r = await budget.invokeRoute(route, input);
	expectWithinBudget(r, LIMIT);
	return { body: r.value as Body, calls: r.calls };
}

/** A sent envelope turned into what E-sign Pro stores for an uploaded PDF, with a known signer token. */
async function pdfEnvelope() {
	process.env.EMDASH_ENCRYPTION_KEY = `emdash_enc_v1_${"A".repeat(43)}`;
	runtime = await createPluginRuntimeTestHost();
	const budget = withBudget(runtime);
	const t = (await call(budget, "templates/create", { name: "Lease", body: "Placeholder.\n" })).body as Body & {
		template: { id: string };
	};
	const created = (
		await call(budget, "envelopes/create", {
			templateId: t.template.id,
			signer: { name: "Ada Lovelace", email: "ada@example.com" },
		})
	).body as Body & { envelope: { id: string } };
	const id = created.envelope.id;
	await call(budget, "envelopes/send", { id });
	const signerId = `${id}:s1`;
	const signer = (await host().inspect.storage.get<Doc>("signers", signerId)) as Doc;
	await host().fixtures.plugin.storage("signers", signerId, { ...signer, tokenHash: await hashToken(TOKEN) });
	const envelope = (await host().inspect.storage.get<Doc>("envelopes", id)) as Doc;
	await host().fixtures.plugin.storage("envelopes", id, {
		...envelope,
		docSha256: PDF_SHA256,
		snapshot: null,
		document: {
			kind: "pdf",
			name: "lease.pdf",
			bytes: 48_213,
			pages: 3,
			// Pro's own details: never shown to the signer.
			ids: ["pdf:dddddddddddddddd:0"],
			fields: [{ kind: "signature", page: 1, x: 72, y: 700, w: 180, h: 60 }],
			templateId: "tpl",
		},
	});
	return { budget, id, signerId };
}

describe("ES-FR-19 an uploaded-PDF envelope on the Free core", () => {
	it("ES-FR-19 the session describes the PDF (name, size, pages) and its SHA-256, reads no snapshot and shows none of Pro's storage", async () => {
		const { budget } = await pdfEnvelope();
		const { body, calls } = await call(budget, "public/session", { token: TOKEN });
		expect(body).toMatchObject({
			ok: true,
			state: "ready",
			envelope: { docSha256: PDF_SHA256 },
			snapshot: "",
			document: { kind: "pdf", name: "lease.pdf", bytes: 48_213, pages: 3 },
		});
		expect(Object.keys(body.document as object).sort()).toEqual(["bytes", "kind", "name", "pages"]);
		// Limiter, signer, envelope and the consent settings: no snapshot read.
		expect(calls.filter((c) => c.collection === "snapshots")).toEqual([]);
		expect(calls).toHaveLength(4);
	});

	it("ES-FR-19 Free refuses to sign it (it cannot show or stamp the PDF) and writes nothing", async () => {
		const { budget, id, signerId } = await pdfEnvelope();
		expect((await call(budget, "public/session", { token: TOKEN, open: true })).body).toMatchObject({ ok: true });
		const events = await host().inspect.storage.list("audit_events");
		const submitted = await call(budget, "public/submit", {
			token: TOKEN,
			consent: true,
			intent: true,
			docSha256: PDF_SHA256,
			consentSha256: CONSENT_SHA256,
			signature: { kind: "typed", typedName: "Ada Lovelace" },
		});
		expect(submitted.body).toMatchObject({ ok: false, error: { code: "ENVELOPE_CLOSED" } });
		expect(await host().inspect.storage.list("audit_events")).toHaveLength(events.length);
		expect(await host().inspect.storage.get<Doc>("signers", signerId)).toMatchObject({ status: "pending" });
		expect(await host().inspect.storage.get<Doc>("envelopes", id)).toMatchObject({ status: "in_progress" });
	});

	it("ES-FR-19 a decline still works, so a signer can always say no", async () => {
		const { budget, id } = await pdfEnvelope();
		await call(budget, "public/session", { token: TOKEN, open: true });
		expect((await call(budget, "public/decline", { token: TOKEN })).body).toMatchObject({
			ok: true,
			status: "declined",
		});
		expect(await host().inspect.storage.get<Doc>("envelopes", id)).toMatchObject({ status: "declined" });
	});
});
