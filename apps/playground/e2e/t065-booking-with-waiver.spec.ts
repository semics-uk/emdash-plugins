import { createHmac, randomInt } from "node:crypto";
import { expect, test } from "@playwright/test";

import { route } from "./harness/esign-journey";

// T065 (SX-FR-01..03): the suite's <BookingWithWaiver> and its waiver page `/_events/waiver`. The site
// is wired with `eventsSuite()` (astro.config.mjs). The playground runs the Free cores only (Pro code
// never enters this repo), so the booking flow degrades to a plain booking here, and the signing half
// is driven with an intent minted the way Events Pro mints one; the Pro answers of the whole flow
// (book → sign → receipt → confirmed) are covered by packages/events-suite/tests/flow.test.ts.

test.describe.configure({ mode: "serial" });

const PAGE = "/e2e/waiver?slug=london-meetup";
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newRef = () => Array.from({ length: 10 }, () => CROCKFORD[randomInt(32)]).join("");
const visitor = () => ({ "x-forwarded-for": `198.51.100.${randomInt(1, 250)}` });

test("SX-FR-02 Free: the waiver booking completes in one flow (no JS) and lands confirmed", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: visitor() });
	const page = await context.newPage();
	await page.goto(PAGE);
	const widget = page.getByTestId("booking-with-waiver");
	await expect(widget.getByRole("heading", { name: "Book with waiver" })).toBeVisible();
	// T066: this event needs no waiver (`public/event` says so), so no attendee rows: ticket and quantity.
	await expect(widget.getByTestId("waiver-plain")).toBeVisible();
	await expect(widget.getByRole("checkbox", { name: /is under 18/i })).toHaveCount(0);

	await page.getByLabel("Your name").fill("Ada Lovelace");
	await page.getByLabel("Your email").fill("ada@example.com");
	await widget.getByLabel("How many").fill("2");
	await widget.getByRole("button", { name: "Book" }).click();

	await expect(page).toHaveURL(/\/booking\?ref=[0-9A-Z]{10}$/);
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	await expect(page.getByTestId("ticket-pass")).toHaveCount(2);
	await context.close();
});

test("SX-FR-02 a name with a control character is refused before anything is booked", async ({ browser }) => {
	const context = await browser.newContext({ extraHTTPHeaders: visitor() });
	const page = await context.newPage();
	await page.goto(PAGE);
	await page.getByLabel("Your email").fill("ada@example.com");
	// A pasted bell character: e-sign would refuse the intent (esign-intent/1 §5 `name`).
	await page.getByLabel("Your name").evaluate((input: HTMLInputElement) => {
		input.value = "Byron\u0007Lovelace";
	});
	await page.getByTestId("booking-with-waiver").getByRole("button", { name: "Book" }).click();

	await expect(page).toHaveURL(/waiver_error=CONTROL_CHARACTERS/);
	expect(page.url()).not.toContain("Byron");
	await expect(page.getByTestId("waiver-alert")).toContainText("control characters");
	await expect(page.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
	await context.close();
});

test("SX-FR-03 the waiver page embeds the ceremony under its CSP and forwards the receipt", async ({ page, request, baseURL }) => {
	// Pair an integration client the way an operator would (T060), then mint the intent Events Pro would.
	await route(request, "admin", { type: "block_action", action_id: "integrations.generate-key" }, true).catch(() => null);
	const created = await route(
		request,
		"admin",
		{ type: "form_submit", action_id: "client.create", values: { name: "Suite", returnUrlAllowlist: `${baseURL}/booking` } },
		true,
	);
	const pairing = /esign1\.([A-Za-z0-9_-]{4,64})\.([A-Za-z0-9_-]{43})/.exec(JSON.stringify(created));
	expect(pairing).not.toBeNull();
	const secret = Buffer.from(pairing?.[2] as string, "base64url");
	const { template } = await route<{ template: { id: string } }>(
		request,
		"templates/create",
		{ name: "Suite waiver", body: "# Waiver\n\nI, {{signer.name}}, accept the risks.\n", integrations: true },
		true,
	);

	const ref = newRef();
	const now = Math.floor(Date.now() / 1000);
	const payload = Buffer.from(
		JSON.stringify({
			v: 1,
			typ: "intent",
			cid: pairing?.[1],
			iat: now,
			exp: now + 600,
			nonce: `t065${Date.now()}nonce0000`,
			tpl: template.id,
			ref: `${ref}:1`,
			signer: { name: "Ada Lovelace", email: `ada.${Date.now()}@example.com` },
			as: "self",
			delivery: "inline",
			prefill: {},
			returnUrl: `${baseURL}/booking?ref=${ref}`,
		}),
	).toString("base64url");
	const intent = `${payload}.${createHmac("sha256", secret).update(`esign-intent/1.${payload}`).digest("base64url")}`;
	const issued = await route<{ signingToken: string }>(request, "public/envelopes/from-intent", { intent });

	// The flow keeps the signing token in an HttpOnly cookie scoped to the waiver page.
	await page.context().addCookies([
		{
			name: `semics_waiver_${ref}`,
			value: issued.signingToken,
			domain: new URL(baseURL as string).hostname,
			path: "/_events/waiver",
			httpOnly: true,
			sameSite: "Strict",
		},
	]);
	const urls: string[] = [];
	page.on("request", (r) => urls.push(r.url()));
	const response = await page.goto(`/_events/waiver?ref=${ref}`);
	const csp = response?.headers()["content-security-policy"] ?? "";
	expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+' 'sha256-/);
	expect(csp).toContain("frame-ancestors 'none'");
	expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
	await expect(page.getByTestId("waiver-page")).toHaveAttribute("data-step", "sign");
	await expect(page.getByTestId("signing-ceremony")).toHaveAttribute("data-state", "ready");

	await page.getByLabel("Type your full name to sign").fill("Ada Lovelace");
	await page.getByLabel(/electronic records and an electronic signature/).check();
	await page.getByLabel(/I intend/).check();
	await page.getByRole("button", { name: "Sign document" }).click();

	// The receipt was forwarded in-process to Events `signatures/receipt`. The Free core's route is a
	// stub (receipts are Pro, T064), so Events reports it could not record it; with Pro it confirms.
	await page.waitForURL(new RegExp(`/booking\\?ref=${ref}&waiver=failed$`));
	for (const url of urls) expect(url).not.toContain(issued.signingToken);
	const cookies = await page.context().cookies(`${baseURL}/_events/waiver`);
	expect(cookies.find((c) => c.name === `semics_waiver_${ref}`)).toBeUndefined();

	const lookup = await route<{ state: string }>(request, "public/receipts/lookup", {
		request: (() => {
			const body = Buffer.from(JSON.stringify({ v: 1, typ: "lookup", cid: pairing?.[1], ts: Math.floor(Date.now() / 1000), ref: `${ref}:1` })).toString("base64url");
			return `${body}.${createHmac("sha256", secret).update(`esign-lookup/1.${body}`).digest("base64url")}`;
		})(),
	});
	expect(lookup.state).toBe("terminal");
});

test("SX-FR-07 the catalogue page asks e-sign for the templates; Free Events has nowhere to cache them", async ({
	page,
	request,
	baseURL,
}) => {
	const created = await route(
		request,
		"admin",
		{ type: "form_submit", action_id: "client.create", values: { name: "Catalogue", returnUrlAllowlist: `${baseURL}/booking` } },
		true,
	);
	const pairing = /esign1\.([A-Za-z0-9_-]{4,64})\.([A-Za-z0-9_-]{43})/.exec(JSON.stringify(created));
	expect(pairing).not.toBeNull();
	const secret = Buffer.from(pairing?.[2] as string, "base64url");
	const { template } = await route<{ template: { id: string } }>(
		request,
		"templates/create",
		{ name: "Catalogue waiver", body: "# Waiver\n\nI accept.\n", integrations: true },
		true,
	);
	// The request Events Pro's Refresh templates mints (esign-catalog/1, §5.4).
	const body = Buffer.from(
		JSON.stringify({ v: 1, typ: "catalog", cid: pairing?.[1], ts: Math.floor(Date.now() / 1000) }),
	).toString("base64url");
	const catalog = `${body}.${createHmac("sha256", secret).update(`esign-catalog/1.${body}`).digest("base64url")}`;
	const direct = await route<{ templates: Array<{ id: string }> }>(request, "public/templates/catalog", { request: catalog });
	expect(direct.templates.map((t) => t.id)).toContain(template.id);

	// No JavaScript needed to see the page; the request itself arrives from the fragment through the client script.
	await page.goto("/_events/templates");
	await expect(page.getByTestId("templates-page")).toBeVisible();
	const posted = await request.post("/_events/templates", {
		form: { catalog },
		headers: { "sec-fetch-site": "same-origin" },
	});
	expect(posted.headers()["referrer-policy"]).toBe("no-referrer");
	expect(await posted.text()).toContain("needs Events Pro");

	const refused = await request.post("/_events/templates", {
		form: { catalog: "nope" },
		headers: { "sec-fetch-site": "same-origin" },
	});
	expect(await refused.text()).toContain("not valid");
	const cross = await request.post("/_events/templates", { form: { catalog }, headers: { "sec-fetch-site": "cross-site" } });
	expect(cross.status()).toBe(403);
});
