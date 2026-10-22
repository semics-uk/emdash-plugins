import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

import { route } from "./harness/esign-journey";

// T062 (ES-FR-14, protocol §8.2-§8.5): an integration pairs with e-sign, mints an inline signing
// intent, the signer signs on `/sign/[token]`, and the browser is sent back to the return URL with
// the receipt in the URL fragment: never in a query string, a path or any request the browser makes.
// The same receipt then comes from `public/receipts/lookup`, and `public/templates/catalog` lists the
// template. Everything goes through the real routes; the client side is minted here with node:crypto,
// as Events would.

test.describe.configure({ mode: "serial" });

const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64url");

function mint(prefix: string, payload: Record<string, unknown>, secret: Buffer): string {
	const segment = b64(JSON.stringify(payload));
	return `${segment}.${createHmac("sha256", secret).update(`${prefix}.${segment}`).digest("base64url")}`;
}

function receiptPayload(token: string, secret: Buffer): Record<string, unknown> {
	const [segment, signature] = token.split(".") as [string, string];
	const expected = createHmac("sha256", secret).update(`esign-receipt/1.${segment}`).digest("base64url");
	expect(signature).toBe(expected);
	return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as Record<string, unknown>;
}

const now = () => Math.floor(Date.now() / 1000);

test("ES-FR-14 SX-NFR-04 SU-FR-09 the receipt returns in the fragment only; lookup and catalogue answer the paired client", async ({
	page,
	request,
	baseURL,
}) => {
	// The e-sign admin: a master key, then a client whose pairing string is shown once.
	await route(request, "admin", { type: "block_action", action_id: "integrations.generate-key" }, true);
	const created = await route(
		request,
		"admin",
		{
			type: "form_submit",
			action_id: "client.create",
			values: { name: "Events", returnUrlAllowlist: `${baseURL}/whats-on` },
		},
		true,
	);
	const pairing = /esign1\.([A-Za-z0-9_-]{4,64})\.([A-Za-z0-9_-]{43})/.exec(JSON.stringify(created));
	expect(pairing, "pairing string in the create response").not.toBeNull();
	const cid = pairing?.[1] as string;
	const secret = Buffer.from(pairing?.[2] as string, "base64url");

	const { template } = await route<{ template: { id: string; version: number } }>(
		request,
		"templates/create",
		{ name: "Climbing waiver", body: "# Waiver\n\nI, {{signer.name}}, accept the risks.\n", integrations: true },
		true,
	);

	const ref = `BK${Date.now()}:A1`;
	const returnUrl = `${baseURL}/whats-on?from=esign`;
	const intent = mint(
		"esign-intent/1",
		{
			v: 1,
			typ: "intent",
			cid,
			iat: now(),
			exp: now() + 600,
			nonce: `e2e${Date.now()}nonce000000`,
			tpl: template.id,
			ref,
			signer: { name: "Grace Hopper", email: `grace.${Date.now()}@example.com` },
			prefill: {},
			returnUrl,
		},
		secret,
	);
	const issued = await route<{ envelopeId: string; status: string; signingToken: string }>(
		request,
		"public/envelopes/from-intent",
		{ intent },
	);
	expect(issued.status).toBe("sent");

	// Every URL the browser requests or navigates to, and the sign page's own redirect.
	const urls: string[] = [];
	page.on("request", (r) => urls.push(r.url()));
	page.on("framenavigated", (f) => urls.push(f.url()));
	let location: string | undefined;
	page.on("response", (r) => {
		if (r.request().method() === "POST" && new URL(r.url()).pathname.startsWith("/sign/")) {
			location = r.headers().location;
		}
	});

	await page.goto(`/sign/${issued.signingToken}`);
	await page.getByLabel("Type your full name to sign").fill("Grace Hopper");
	await page.getByLabel(/electronic records and an electronic signature/).check();
	await page.getByLabel(/I intend/).check();
	await page.getByRole("button", { name: "Sign document" }).click();
	await page.waitForURL(/\/whats-on\?from=esign#receipt=/);

	const landed = new URL(page.url());
	const receipt = landed.hash.replace(/^#receipt=/, "");
	expect(receipt).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
	// The query string is the return URL's own, preserved; the receipt is only in the fragment.
	expect(landed.search).toBe("?from=esign");
	expect(location).toBe(`${returnUrl}#receipt=${receipt}`);
	for (const url of urls) {
		const seen = new URL(url);
		expect(seen.search, url).not.toContain(receipt);
		expect(seen.pathname, url).not.toContain(receipt);
		expect(seen.search, url).not.toContain("receipt");
	}

	const payload = receiptPayload(receipt, secret);
	expect(payload).toMatchObject({
		v: 1,
		typ: "receipt",
		cid,
		envelopeId: issued.envelopeId,
		ref,
		status: "completed",
		pdfSha256: null,
	});
	expect(payload.finalHash).toMatch(/^[0-9a-f]{64}$/);

	// Lookup: the same envelope, terminal, under this client only.
	const lookup = await route<{ state: string; receipt: string }>(request, "public/receipts/lookup", {
		request: mint("esign-lookup/1", { v: 1, typ: "lookup", cid, ts: now(), ref }, secret),
	});
	expect(lookup.state).toBe("terminal");
	expect(receiptPayload(lookup.receipt, secret)).toMatchObject({ envelopeId: issued.envelopeId, status: "completed" });

	const catalog = await route<{ templates: Array<{ id: string; name: string; version: number }> }>(
		request,
		"public/templates/catalog",
		{ request: mint("esign-catalog/1", { v: 1, typ: "catalog", cid, ts: now() }, secret) },
	);
	expect(catalog.templates).toContainEqual({ id: template.id, name: "Climbing waiver", version: template.version });
});
