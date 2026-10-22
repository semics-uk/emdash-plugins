import { describe, expect, it } from "vitest";

import { forwardReceipt, startDoorSigning } from "../../src/astro/lib/receipt";
import { submitFragmentForms, takeFragmentToken } from "../../src/client/receipt";

// The Events side of the receipt redirect and door signing (EV-FR-12, SX-FR-04; esign-intent/1 §8.2,
// §8.3). Tokens arrive in the URL fragment, which never reaches a server or a Referer; the page
// clears it with history.replaceState and POSTs it.

const RECEIPT = `${"p".repeat(120)}.${"s".repeat(43)}`;
const url = new URL("https://site.example/booking?ref=ABCDEFGHJK");

function host(answers: Record<string, unknown>) {
	const seen: Array<{ id: string; path: string; body: unknown }> = [];
	const handler = async (id: string, _method: string, path: string, request: Request) => {
		seen.push({ id, path, body: await request.clone().json() });
		return answers[`${id} ${path}`] ?? { success: true, data: { ok: false, error: { code: "NOT_FOUND" } } };
	};
	return { seen, ctx: { locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url } };
}
const okData = (data: Record<string, unknown>) => ({ success: true, data: { ok: true, ...data } });

describe("return page: the receipt fragment (SX-FR-04, §8.2)", () => {
	function page(hash: string) {
		const replaced: string[] = [];
		const loc = { hash, pathname: "/booking", search: "?ref=ABCDEFGHJK" };
		const hist = { replaceState: (_s: unknown, _t: string, to: string) => void replaced.push(to) };
		return { loc, hist, replaced };
	}

	it("SX-FR-04 SU-FR-09 reads #receipt= and clears it with history.replaceState, keeping the query", () => {
		const p = page(`#receipt=${RECEIPT}`);
		expect(takeFragmentToken("receipt", p.loc, p.hist)).toBe(RECEIPT);
		expect(p.replaced).toEqual(["/booking?ref=ABCDEFGHJK"]);
	});

	it("SX-FR-04 any other fragment is left alone", () => {
		for (const hash of ["", "#", "#intent=abc", "#receipt=", "#receiptx=abc"]) {
			const p = page(hash);
			expect(takeFragmentToken("receipt", p.loc, p.hist), hash).toBeNull();
			expect(p.replaced).toEqual([]);
		}
	});

	it("SX-FR-04 fills the page's hidden form with the token and submits it (a POST, never a URL)", () => {
		const submitted: Array<Record<string, string>> = [];
		const input = { name: "receipt", value: "" };
		const form = {
			dataset: { semicsFragment: "receipt" },
			querySelector: (sel: string) => (sel === 'input[name="receipt"]' ? input : null),
			submit: () => void submitted.push({ receipt: input.value }),
		};
		const doc = { querySelectorAll: () => [form] };
		const p = page(`#receipt=${RECEIPT}`);
		expect(submitFragmentForms(doc as never, p.loc, p.hist)).toBe(1);
		expect(submitted).toEqual([{ receipt: RECEIPT }]);
		expect(submitFragmentForms(doc as never, page("").loc, p.hist)).toBe(0);
	});
});

describe("forwardReceipt: POST to signatures/receipt (EV-FR-12, §8.4)", () => {
	it("EV-FR-12 forwards the receipt and reports the outcome on the booking page, without the token", async () => {
		const h = host({
			"semics-events signatures/receipt": okData({ status: "confirmed", signature: { status: "completed" } }),
		});
		const out = await forwardReceipt(h.ctx, { ref: "ABCDEFGHJK", receipt: RECEIPT }, {});
		expect(h.seen).toEqual([{ id: "semics-events", path: "signatures/receipt", body: { receipt: RECEIPT } }]);
		expect(out.location).toBe("/booking?ref=ABCDEFGHJK&waiver=signed");
		expect(out.location).not.toContain(RECEIPT.slice(0, 20));
	});

	it("EV-FR-12 a declined receipt, a refusal and a malformed token each get their own notice", async () => {
		const declined = host({
			"semics-events signatures/receipt": okData({ status: "awaiting_signature", signature: { status: "declined" } }),
		});
		expect((await forwardReceipt(declined.ctx, { ref: "ABCDEFGHJK", receipt: RECEIPT }, {})).location).toBe(
			"/booking?ref=ABCDEFGHJK&waiver=declined",
		);
		const refused = host({
			"semics-events signatures/receipt": { success: true, data: { ok: false, error: { code: "TOKEN_INVALID" } } },
		});
		expect((await forwardReceipt(refused.ctx, { ref: "ABCDEFGHJK", receipt: RECEIPT }, {})).location).toBe(
			"/booking?ref=ABCDEFGHJK&waiver=failed",
		);
		const malformed = host({});
		for (const receipt of ["", "no-dot", 7, "x".repeat(3000)]) {
			expect((await forwardReceipt(malformed.ctx, { ref: "ABCDEFGHJK", receipt }, {})).location).toBe(
				"/booking?ref=ABCDEFGHJK&waiver=failed",
			);
		}
		expect(malformed.seen).toEqual([]);
		// A bad ref is dropped from the redirect.
		expect((await forwardReceipt(malformed.ctx, { ref: "<x>", receipt: "" }, {})).location).toBe(
			"/booking?waiver=failed",
		);
	});

	it("SX-FR-04 with pdfSha256 still null, it asks e-sign's receipts/lookup and forwards the full receipt", async () => {
		const FULL = `${"q".repeat(120)}.${"s".repeat(43)}`;
		const h = host({
			"semics-events signatures/receipt": okData({
				status: "confirmed",
				signature: { status: "completed", pdfPending: true },
				lookup: "lookup-token",
			}),
			"semics-esign public/receipts/lookup": okData({ state: "terminal", receipt: FULL }),
		});
		const out = await forwardReceipt(h.ctx, { ref: "ABCDEFGHJK", receipt: RECEIPT }, { esignPluginId: "semics-esign" });
		expect(h.seen.map((s) => `${s.id} ${s.path}`)).toEqual([
			"semics-events signatures/receipt",
			"semics-esign public/receipts/lookup",
			"semics-events signatures/receipt",
		]);
		expect(h.seen[1]?.body).toEqual({ request: "lookup-token" });
		expect(h.seen[2]?.body).toEqual({ receipt: FULL });
		expect(out.location).toBe("/booking?ref=ABCDEFGHJK&waiver=signed");
	});

	it("SX-FR-04 without the e-sign plugin id, or with the lookup still pending, it stops after the first post", async () => {
		const answers = {
			"semics-events signatures/receipt": okData({
				status: "confirmed",
				signature: { status: "completed" },
				lookup: "l",
			}),
			"semics-esign public/receipts/lookup": okData({ state: "pending", receipt: null }),
		};
		const a = host(answers);
		await forwardReceipt(a.ctx, { ref: "ABCDEFGHJK", receipt: RECEIPT }, {});
		expect(a.seen).toHaveLength(1);
		const b = host(answers);
		await forwardReceipt(b.ctx, { ref: "ABCDEFGHJK", receipt: RECEIPT }, { esignPluginId: "semics-esign" });
		expect(b.seen).toHaveLength(2);
	});
});

describe("startDoorSigning: staff open the signing page at check-in (EV-FR-12)", () => {
	const INTENT = `${"i".repeat(200)}.${"s".repeat(43)}`;

	it("EV-FR-12 redeems the intent with e-sign in-process and goes to the signing page", async () => {
		const h = host({
			"semics-esign public/envelopes/from-intent": okData({
				envelopeId: "env_1",
				status: "sent",
				signingToken: "tok_abc",
			}),
		});
		const out = await startDoorSigning(h.ctx, INTENT, { esignPluginId: "semics-esign" });
		expect(out).toEqual({ location: "/sign/tok_abc" });
		expect(h.seen).toEqual([{ id: "semics-esign", path: "public/envelopes/from-intent", body: { intent: INTENT } }]);
	});

	it("EV-FR-12 refuses without the e-sign plugin, with a malformed intent, or when e-sign gives no inline token", async () => {
		const none = host({});
		expect(await startDoorSigning(none.ctx, INTENT, {})).toEqual({ error: "ESIGN_NOT_CONFIGURED" });
		expect(await startDoorSigning(none.ctx, "x", { esignPluginId: "semics-esign" })).toEqual({
			error: "INTENT_INVALID",
		});
		expect(none.seen).toEqual([]);
		const email = host({
			"semics-esign public/envelopes/from-intent": okData({ envelopeId: "e", status: "completed" }),
		});
		expect(await startDoorSigning(email.ctx, INTENT, { esignPluginId: "semics-esign" })).toEqual({
			error: "SIGNING_UNAVAILABLE",
		});
		const refused = host({
			"semics-esign public/envelopes/from-intent": {
				success: true,
				data: { ok: false, error: { code: "TOKEN_EXPIRED" } },
			},
		});
		expect(await startDoorSigning(refused.ctx, INTENT, { esignPluginId: "semics-esign" })).toEqual({
			error: "TOKEN_EXPIRED",
		});
	});

	const LOOKUP = `${"l".repeat(120)}.${"s".repeat(43)}`;

	it("T119 F5 an emailed adult who signed without JavaScript: the link's lookup fetches the receipt and records it", async () => {
		const h = host({
			"semics-esign public/envelopes/from-intent": okData({ envelopeId: "env_3", status: "completed" }),
			"semics-esign public/receipts/lookup": okData({ state: "terminal", receipt: RECEIPT }),
			"semics-events signatures/receipt": okData({ status: "confirmed", signature: { status: "completed" } }),
		});
		const out = await startDoorSigning(h.ctx, INTENT, { esignPluginId: "semics-esign" }, LOOKUP);
		expect(out).toEqual({ signed: true });
		expect(h.seen).toEqual([
			{ id: "semics-esign", path: "public/envelopes/from-intent", body: { intent: INTENT } },
			{ id: "semics-esign", path: "public/receipts/lookup", body: { request: LOOKUP } },
			{ id: "semics-events", path: "signatures/receipt", body: { receipt: RECEIPT } },
		]);
	});

	it("T119 F5 no lookup, a malformed one, a pending one or a refused receipt still answer SIGNING_UNAVAILABLE", async () => {
		const answers = (lookup: unknown, receipt: unknown = okData({ signature: { status: "completed" } })) => ({
			"semics-esign public/envelopes/from-intent": okData({ envelopeId: "env_3", status: "completed" }),
			"semics-esign public/receipts/lookup": lookup,
			"semics-events signatures/receipt": receipt,
		});
		const terminal = okData({ state: "terminal", receipt: RECEIPT });
		for (const [name, h, lookup] of [
			["no lookup", host(answers(terminal)), undefined],
			["malformed", host(answers(terminal)), "x"],
			["pending", host(answers(okData({ state: "pending", receipt: null }))), LOOKUP],
			["declined", host(answers(terminal, okData({ signature: { status: "declined" } }))), LOOKUP],
			["refused", host(answers(terminal, { success: true, data: { ok: false, error: { code: "X" } } })), LOOKUP],
		] as const) {
			expect(await startDoorSigning(h.ctx, INTENT, { esignPluginId: "semics-esign" }, lookup), name).toEqual({
				error: "SIGNING_UNAVAILABLE",
			});
		}
	});

	it("T119 F5 the door fragment carries the intent and the lookup: both go into the form, the fragment is cleared", () => {
		const inputs: Record<string, { value: string }> = { intent: { value: "" }, lookup: { value: "" } };
		let submitted = 0;
		const form = {
			dataset: { semicsFragment: "intent" },
			querySelector: (sel: string) => inputs[/name="(\w+)"/.exec(sel)?.[1] ?? ""] ?? null,
			submit: () => void submitted++,
		};
		const replaced: string[] = [];
		const loc = { hash: `#intent=${INTENT}&lookup=${LOOKUP}`, pathname: "/_events/sign", search: "" };
		const hist = { replaceState: (_s: unknown, _t: string, to: string) => void replaced.push(to) };
		expect(submitFragmentForms({ querySelectorAll: () => [form] } as never, loc, hist)).toBe(1);
		expect({ intent: inputs.intent?.value, lookup: inputs.lookup?.value }).toEqual({ intent: INTENT, lookup: LOOKUP });
		expect(submitted).toBe(1);
		expect(replaced).toEqual(["/_events/sign"]);
		// A fragment with a value that is not a token is left alone.
		const bad = { ...loc, hash: `#intent=${INTENT}&lookup=<x>` };
		expect(takeFragmentToken("intent", bad, hist)).toBeNull();
	});
});
