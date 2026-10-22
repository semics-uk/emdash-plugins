import AxeBuilder from "@axe-core/playwright";
import { expect, request as playwrightRequest, test } from "@playwright/test";

import {
	createAndSend,
	route,
	sha256,
	signViaRoutes,
	waitForCompletionToken,
	waitForPdf,
} from "./harness/esign-journey";

// T032 (SU-FR-02, ES-US-6): /verify hashes a dropped PDF in the browser and posts only the hash;
// /signed/[token] is the stable "get my signed copy" page the completion email links to.

// One envelope signed through the real routes (T033 replaced the T032 direct-storage fixture): its
// stored PDF is what the tests drop on /verify, and the completion email's token opens /signed/<token>.
let SIGNED_PDF: Buffer;
let SIGNED_PDF_SHA256: string;
let SIGNED_COPY_TOKEN: string;
let pdf: { name: string; mimeType: string; buffer: Buffer };

test.beforeAll(async ({ baseURL }) => {
	const api = await playwrightRequest.newContext({ baseURL: baseURL ?? "http://127.0.0.1:4401" });
	try {
		const sent = await createAndSend(api, "Verify page agreement");
		await signViaRoutes(api, sent);
		const done = await waitForPdf(api, sent.envelopeId);
		SIGNED_COPY_TOKEN = await waitForCompletionToken(api, sent);
		const { download } = await route<{ download: { url: string } }>(api, "public/session", { token: SIGNED_COPY_TOKEN });
		SIGNED_PDF = await (await api.get(download.url)).body();
		SIGNED_PDF_SHA256 = sha256(SIGNED_PDF);
		if (SIGNED_PDF_SHA256 !== done.pdfSha256) throw new Error("downloaded PDF does not match the receipt");
		pdf = { name: "signed.pdf", mimeType: "application/pdf", buffer: SIGNED_PDF };
	} finally {
		await api.dispose();
	}
});

test("ES-US-6 SU-FR-10 choosing the signed PDF shows matched, and only the hash is posted", async ({ page }) => {
	const posts: { url: string; type: string; body: string }[] = [];
	page.on("request", (r) => {
		if (r.method() === "POST")
			posts.push({ url: r.url(), type: r.headers()["content-type"] ?? "", body: r.postData() ?? "" });
	});
	await page.goto("/verify");
	await page.getByLabel("Signed PDF").setInputFiles(pdf);
	await expect(page.getByTestId("verify-result")).toBeVisible();
	await expect(page.getByTestId("verify-result")).toHaveAttribute("data-matched", "true");
	await expect(page.getByTestId("verify-result")).toContainText(/was issued here/i);
	await expect(page.getByTestId("verify-chain")).toHaveText("Its audit trail is intact.");

	expect(posts).toHaveLength(1);
	expect(new URL(posts[0]!.url).pathname).toBe("/verify");
	expect(posts[0]!.type).toContain("application/x-www-form-urlencoded");
	expect(posts[0]!.type).not.toContain("multipart");
	expect(posts[0]!.body).toBe(`sha256=${SIGNED_PDF_SHA256}`);
	expect(posts[0]!.body).not.toContain("PDF");
});

test("ES-US-6 dropping a PDF on the zone matches too; a different PDF is not found", async ({ page }) => {
	await page.goto("/verify");
	const drop = async (bytes: Buffer) => {
		const data = await page.evaluateHandle((b) => {
			const dt = new DataTransfer();
			dt.items.add(new File([new Uint8Array(b)], "x.pdf", { type: "application/pdf" }));
			return dt;
		}, [...bytes]);
		await page.locator("[data-esign-drop]").dispatchEvent("drop", { dataTransfer: data });
	};
	await drop(SIGNED_PDF);
	await expect(page.getByTestId("verify-result")).toHaveAttribute("data-matched", "true");
	await page.goto("/verify");
	await drop(Buffer.from("%PDF-1.4 something else"));
	await expect(page.getByTestId("verify-result")).toHaveAttribute("data-matched", "false");
});

test("ES-US-6 the pasted-hash path works without JavaScript", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto("/verify");
	await page.getByLabel("Document SHA-256").fill(SIGNED_PDF_SHA256.toUpperCase());
	await page.getByRole("button", { name: /verify/i }).click();
	await expect(page.getByTestId("verify-result")).toHaveAttribute("data-matched", "true");
	await context.close();
});

test("SU-NFR-02 /verify has a strict CSP, no-referrer, an accessible file input and no axe violations", async ({ page }) => {
	const response = await page.goto("/verify");
	const headers = response?.headers() ?? {};
	expect(headers["referrer-policy"]).toBe("no-referrer");
	expect(headers["content-security-policy"]).toContain("default-src 'none'");
	expect(headers["content-security-policy"]).not.toContain("unsafe-");
	const errors: string[] = [];
	page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
	page.on("pageerror", (e) => errors.push(e.message));
	await page.reload();
	await expect(page.getByLabel("Signed PDF")).toBeVisible();
	expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
	expect(errors).toEqual([]);
});

test("ES-US-6 /signed/<token> issues a fresh download link, with the headers and no token elsewhere", async ({ page }) => {
	const urls: string[] = [];
	page.on("request", (r) => urls.push(r.url()));
	const response = await page.goto(`/signed/${SIGNED_COPY_TOKEN}`);
	expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
	expect(response?.headers()["cache-control"]).toContain("no-store");
	await expect(page.getByTestId("signed-copy-page")).toBeVisible();
	const link = page.getByRole("link", { name: /download the signed pdf/i });
	await expect(link).toBeVisible();
	expect(await link.getAttribute("href")).toContain("public/download?");
	expect(await link.getAttribute("href")).not.toContain(SIGNED_COPY_TOKEN);
	expect(urls.filter((u) => u.includes(SIGNED_COPY_TOKEN) && new URL(u).pathname !== `/signed/${SIGNED_COPY_TOKEN}`)).toEqual([]);
	expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("ES-US-6 /signed/<bad token> shows a defined error", async ({ page }) => {
	await page.goto(`/signed/${"x".repeat(43)}`);
	await expect(page.getByTestId("sign-error")).toBeVisible();
});
