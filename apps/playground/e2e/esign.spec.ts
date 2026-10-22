import { expect, test } from "@playwright/test";

import { createAndSend, PHONE, receipt, SIGNER, sha256, signerDoc, signViaRoutes, waitForCompletionToken, waitForPdf } from "./harness/esign-journey";

// T033 (Phase 1 exit): the whole e-sign journey through the real routes and pages. The admin creates a
// template and sends an envelope (private routes, e2e API token), the signer opens the emailed
// `/sign/[token]` link and signs with a drawn signature, the signed PDF is downloaded and its SHA-256
// must equal the receipt's `pdfSha256`, and `/verify` accepts that PDF with an intact audit chain.

test.describe.configure({ mode: "serial" });

test("ES-US-1..6 send, sign with a drawn signature, download the PDF, verify it", async ({ page, request }) => {
	const sent = await createAndSend(request);
	const started = await receipt(request, sent.envelopeId);
	expect(started.status).toBe("sent");

	// The signer's page: the document, the sender's fields filled in, the signer-fillable field.
	const response = await page.goto(`/sign/${sent.token}`);
	expect(response?.headers()["referrer-policy"]).toBe("no-referrer");
	await expect(page.getByTestId("sign-document")).toContainText("The Old Library");
	await expect(page.getByTestId("sign-document")).toContainText(SIGNER.name);

	await page.getByLabel("Type your full name to sign").fill(SIGNER.name);
	await page.getByLabel(/Phone number/).fill(PHONE);
	await page.getByLabel(/sign this document electronically/).check();
	await page.getByLabel(/I intend/).check();
	const canvas = page.getByTestId("sign-pad");
	await canvas.scrollIntoViewIfNeeded();
	const box = (await canvas.boundingBox())!;
	await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.6);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.2, { steps: 6 });
	await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.7, { steps: 6 });
	await page.mouse.up();
	await page.getByRole("button", { name: "Sign document" }).click();
	await expect(page.getByTestId("sign-done")).toBeVisible();
	// T115: the page's own poll still holds the signing token (the completion email mints a separate copy
	// token), so the download link appears here once the job has stored the PDF.
	await expect(page.getByTestId("sign-done").getByRole("link", { name: /download the signed pdf/i })).toBeVisible({
		timeout: 30_000,
	});

	// What was stored: the drawn strokes, the typed name and the signer-filled field.
	expect(signerDoc(sent.envelopeId)).toMatchObject({
		status: "signed",
		signature: { kind: "drawn", typedName: SIGNER.name },
		fieldValues: { phone: PHONE },
	});

	// The one-shot job builds the PDF; the completion email then links the stable "signed copy" page.
	const done = await waitForPdf(request, sent.envelopeId);
	const copyToken = await waitForCompletionToken(sent.envelopeId);
	await page.goto(`/signed/${copyToken}`);
	const link = page.getByRole("link", { name: /download the signed pdf/i });
	await expect(link).toBeVisible();
	const href = (await link.getAttribute("href"))!;
	expect(href).toContain("public/download?");
	expect(href).not.toContain(copyToken);
	const download = await page.request.get(href);
	expect(download.ok()).toBe(true);
	expect(download.headers()["content-type"]).toContain("application/pdf");
	const pdf = await download.body();
	expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");

	// The receipt (the admin's envelope) carries the hash of exactly these bytes.
	expect(done.status).toBe("completed");
	expect(done.pdfSha256).toBe(sha256(pdf));

	// /verify: the PDF is recognised and the audit chain verifies end to end.
	await page.goto("/verify");
	await page.getByLabel("Signed PDF").setInputFiles({ name: "signed.pdf", mimeType: "application/pdf", buffer: pdf });
	await expect(page.getByTestId("verify-result")).toHaveAttribute("data-matched", "true");
	await expect(page.getByTestId("verify-chain")).toHaveText("Its audit trail is intact.");

	// The same fact through the route: the fingerprint matches, the chain is verified, `finalHash` agrees.
	const verified = await page.request.post("/_emdash/api/plugins/semics-esign/public/verify", {
		data: { sha256: done.pdfSha256 },
		headers: { "x-emdash-request": "1" },
	});
	const body = ((await verified.json()) as { data: Record<string, unknown> }).data;
	expect(body).toMatchObject({ matched: true, chainVerified: true, finalHash: done.finalHash });

	// A tampered copy is not recognised.
	await page.goto("/verify");
	await page.getByLabel("Signed PDF").setInputFiles({
		name: "tampered.pdf",
		mimeType: "application/pdf",
		buffer: Buffer.concat([pdf, Buffer.from("\n%edit")]),
	});
	await expect(page.getByTestId("verify-result")).toHaveAttribute("data-matched", "false");
});

test("ES-US-1 a used signing link no longer opens the document", async ({ page, request }) => {
	const sent = await createAndSend(request, "Second agreement");
	await page.goto(`/sign/${sent.token}`);
	await expect(page.getByTestId("sign-document")).toBeVisible();
	await signViaRoutes(request, sent);
	await page.reload();
	await expect(page.getByTestId("sign-document")).toHaveCount(0);
	await expect(page.getByTestId("sign-closed")).toContainText("has been signed");
});
