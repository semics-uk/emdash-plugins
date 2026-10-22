import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { type Browser, expect, type Page, test } from "@playwright/test";

// T030 (SU-FR-03..08, SU-NFR-01..03): <SigningCeremony>. `/e2e/ceremony` renders the component in
// fixed states (?state=ready|signed|closed, ?doc=xss for the payload suite, ?csp=off to drop the
// header so the sanitiser is tested on its own). The full send-sign-download journey is T033.

const TOKEN = "T".repeat(43);
const payloads = JSON.parse(
	readFileSync(new URL("../../../packages/esign/tests/ui/xss-payloads.json", import.meta.url), "utf8"),
) as string[];
const ALLOWED_TAGS = new Set(["H2", "H3", "H4", "H5", "H6", "P", "UL", "OL", "LI", "BLOCKQUOTE", "PRE", "CODE", "STRONG", "EM", "A", "BR", "HR"]);
const ALLOWED_ATTRS = new Set(["href", "rel", "start", "class"]);

async function seriousViolations(page: Page) {
	const results = await new AxeBuilder({ page }).include(".semics-esign").analyze();
	return results.violations
		.filter((v) => v.impact === "serious" || v.impact === "critical")
		.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
}

async function noJs(browser: Browser, width?: number) {
	const context = await browser.newContext({
		javaScriptEnabled: false,
		...(width ? { viewport: { width, height: 800 } } : {}),
	});
	return { context, page: await context.newPage() };
}

/** Records CSP violations the page reports. */
async function watchCsp(page: Page) {
	await page.addInitScript(() => {
		(window as unknown as { __csp: string[] }).__csp = [];
		document.addEventListener("securitypolicyviolation", (e) =>
			(window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
		);
	});
	return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

const sha256 = (text: string) => `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;

test("SU-NFR-01 ES-NFR-05 XSS payload suite: nothing executes and only allowed markup survives", async ({ page }) => {
	const hits: string[] = [];
	page.on("dialog", (d) => {
		hits.push(`dialog ${d.message()}`);
		void d.dismiss();
	});
	await page.exposeFunction("__xssHit", (id: string) => hits.push(id));
	await page.addInitScript(() => {
		(window as unknown as { __xss: (id: string) => void }).__xss = (id) =>
			(window as unknown as { __xssHit: (id: string) => void }).__xssHit(id);
	});
	const external: string[] = [];
	page.on("request", (r) => {
		if (!r.url().startsWith("http://127.0.0.1")) external.push(r.url());
	});
	// No CSP here: the sanitiser alone must hold.
	await page.goto("/e2e/ceremony?doc=xss&csp=off");
	const doc = page.getByTestId("sign-document");
	await expect(doc).toBeVisible();
	for (const link of await doc.locator("a").all()) await link.hover();
	await page.waitForTimeout(500);
	expect(hits).toEqual([]);
	expect(external).toEqual([]);

	const markup = await doc.locator(".semics-doc").evaluate((root) => {
		const tags = new Set<string>();
		const attrs = new Set<string>();
		const hrefs: string[] = [];
		for (const el of root.querySelectorAll("*")) {
			tags.add(el.tagName);
			for (const a of el.attributes) attrs.add(a.name);
			if (el instanceof HTMLAnchorElement) hrefs.push(el.getAttribute("href") ?? "");
		}
		return { tags: [...tags], attrs: [...attrs], hrefs };
	});
	for (const tag of markup.tags) expect(ALLOWED_TAGS.has(tag), tag).toBe(true);
	for (const attr of markup.attrs) expect(ALLOWED_ATTRS.has(attr), attr).toBe(true);
	for (const href of markup.hrefs) expect(href).toMatch(/^(https?:\/\/|mailto:)/);
	// The payloads are shown to the signer as text.
	const text = await doc.locator(".semics-doc").innerText();
	expect(text).toContain("<script>window.__xss('script')</script>");
	expect(text).toContain("[click](javascript:window.__xss('md-link'))");
	expect(payloads.length).toBeGreaterThanOrEqual(40);
	// The exact hashed text is available verbatim.
	await expect(page.getByTestId("sign-exact")).toContainText("<SCRIPT SRC=//evil.example/x.js></SCRIPT>", { useInnerText: false });
});

test("SU-NFR-02 the CSP header allows only the package's hashed script, and that script runs under it", async ({ page, request }) => {
	for (const path of [`/sign/${TOKEN}`, "/e2e/ceremony"]) {
		const response = await request.get(path);
		const csp = response.headers()["content-security-policy"] ?? "";
		expect(csp, path).toContain("default-src 'none'");
		expect(csp, path).not.toContain("unsafe-inline");
		const scriptSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
		expect(scriptSrc?.split(/\s+/).slice(1), path).toHaveLength(2);
		const html = await response.text();
		const inline = [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1] as string);
		// The ceremony script and the signature pad script (T031).
		expect(inline, path).toHaveLength(2);
		expect(scriptSrc, path).toBe(`script-src ${inline.map(sha256).join(" ")}`);
		expect(html, path).not.toMatch(/<script(?![^>]*type="module">)[^>]*>/);
	}
	const violations = await watchCsp(page);
	await page.goto("/e2e/ceremony");
	// The script ran (it disables Sign until the form is complete) and nothing was blocked.
	await expect(page.getByRole("button", { name: "Sign document" })).toBeDisabled();
	expect(await violations()).toEqual([]);
});

test("SU-FR-04 Sign stays disabled until consent, intent and required fields are complete", async ({ page }) => {
	await page.goto("/e2e/ceremony");
	const sign = page.getByRole("button", { name: "Sign document" });
	await expect(sign).toBeDisabled();
	await page.getByLabel("Type your full name to sign").fill("Ada Lovelace");
	await expect(sign).toBeDisabled();
	await page.getByLabel(/electronic records and an electronic signature/).check();
	await expect(sign).toBeDisabled();
	await page.getByLabel(/I intend/).check();
	await expect(sign).toBeDisabled();
	await page.getByLabel(/Company/).fill("Analytical Engines Ltd");
	await expect(sign).toBeEnabled();
	await page.getByLabel(/electronic records and an electronic signature/).uncheck();
	await expect(sign).toBeDisabled();
	await expect(page.getByTestId("sign-missing")).toContainText(/consent/i);
});

test("SU-FR-04 without JavaScript the Sign button stays usable and the server checks the form", async ({ browser }) => {
	const { context, page } = await noJs(browser);
	await page.goto("/e2e/ceremony");
	await expect(page.getByRole("button", { name: "Sign document" })).toBeEnabled();
	await expect(page.getByTestId("sign-pad-slot")).toBeAttached();
	await context.close();
});

test("SU-FR-07 after signing, the page polls the session and shows the signed PDF link when ready", async ({ page }) => {
	let calls = 0;
	await page.route("**/_emdash/api/plugins/*/public/session", async (route) => {
		calls++;
		const body = route.request().postDataJSON() as { token?: string };
		expect(body.token).toBe(TOKEN);
		const data =
			calls < 2
				? { ok: true, state: "closed", status: "completed", pdf: "pending" }
				: { ok: true, state: "closed", status: "completed", pdf: "ready", download: { url: "/signed.pdf", expiresAt: "2030-01-01T00:00:00Z" } };
		await route.fulfill({ json: { success: true, data } });
	});
	await page.goto("/e2e/ceremony?state=signed");
	const link = page.getByRole("link", { name: "Download the signed PDF" });
	await expect(link).toBeVisible({ timeout: 15_000 });
	expect(await link.getAttribute("href")).toMatch(/\/signed\.pdf$/);
	expect(calls).toBeGreaterThanOrEqual(2);
});

test("SU-NFR-03 axe finds no serious violations in the ceremony states", async ({ page }) => {
	await page.route("**/_emdash/api/plugins/*/public/session", (route) => route.abort());
	for (const path of ["/e2e/ceremony", "/e2e/ceremony?doc=xss", "/e2e/ceremony?state=signed", "/e2e/ceremony?state=closed", `/sign/${TOKEN}`]) {
		await page.goto(path);
		expect(await seriousViolations(page), path).toEqual([]);
	}
});

test("SU-NFR-03 SU-NFR-05 works at 320 px: no sideways scrolling and every control reachable", async ({ browser }) => {
	for (const js of [false, true]) {
		const context = await browser.newContext({ javaScriptEnabled: js, viewport: { width: 320, height: 800 } });
		const page = await context.newPage();
		for (const path of ["/e2e/ceremony", "/e2e/ceremony?doc=xss"]) {
			await page.goto(path);
			const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
			expect(overflow, path).toBeLessThanOrEqual(0);
			for (const control of await page.locator(".semics-esign input:visible, .semics-esign button:visible").all()) {
				const box = await control.boundingBox();
				expect(box && box.x >= 0 && box.x + box.width <= 320, path).toBe(true);
			}
		}
		await context.close();
	}
});
