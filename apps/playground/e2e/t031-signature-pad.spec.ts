import { expect, type Page, test } from "@playwright/test";

// T031 (SU-FR-05, SU-NFR-04): the signature pad inside <SigningCeremony> (`/e2e/ceremony`).
// It writes `{ v, w, h, strokes }` to the hidden `signatureStrokes` input; never a raster.

const strokesInput = (page: Page) => page.locator('input[name="signatureStrokes"]');

async function value(page: Page) {
	const raw = await strokesInput(page).inputValue();
	return raw === "" ? null : (JSON.parse(raw) as { v: number; w: number; h: number; strokes: number[][][] });
}

/** Dispatches a full pointer-event stroke of the given kind across the canvas, as a real device would. */
async function drawWith(page: Page, pointerType: "mouse" | "touch" | "pen", id: number, from = 0.1) {
	await page.getByTestId("sign-pad").evaluate(
		(canvas, args) => {
			const r = canvas.getBoundingClientRect();
			const at = (fx: number, fy: number, type: string, buttons: number) =>
				canvas.dispatchEvent(
					new PointerEvent(type, {
						bubbles: true,
						cancelable: true,
						pointerId: args.id,
						pointerType: args.pointerType,
						isPrimary: true,
						button: 0,
						buttons,
						clientX: r.left + r.width * fx,
						clientY: r.top + r.height * fy,
					}),
				);
			at(args.from, 0.5, "pointerdown", 1);
			at(args.from + 0.1, 0.2, "pointermove", 1);
			at(args.from + 0.2, 0.8, "pointermove", 1);
			at(args.from + 0.3, 0.5, "pointerup", 0);
		},
		{ pointerType, id, from },
	);
}

test("SU-FR-05 a mouse stroke is written as { v, w, h, strokes } JSON with a bubbling input event", async ({ page }) => {
	await page.goto("/e2e/ceremony");
	const canvas = page.getByTestId("sign-pad");
	await expect(canvas).toBeVisible();
	await page.evaluate(() => {
		(window as unknown as { __inputs: number }).__inputs = 0;
		document.querySelector("form")?.addEventListener("input", (e) => {
			if ((e.target as HTMLInputElement).name === "signatureStrokes") (window as unknown as { __inputs: number }).__inputs++;
		});
	});
	await canvas.scrollIntoViewIfNeeded();
	const box = (await canvas.boundingBox())!;
	await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.5);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.2, { steps: 5 });
	await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.8, { steps: 5 });
	await page.mouse.up();
	const pad = await value(page);
	expect(pad).toMatchObject({ v: 1, w: 600, h: 200 });
	expect(pad?.strokes).toHaveLength(1);
	const points = pad!.strokes[0]!;
	expect(points.length).toBeGreaterThan(5);
	expect(points[0]).toEqual([60, 100]);
	expect(points.at(-1)).toEqual([540, 160]);
	expect(await page.evaluate(() => (window as unknown as { __inputs: number }).__inputs)).toBeGreaterThan(0);
	// Drawing alone never satisfies the typed name.
	await expect(page.getByRole("button", { name: "Sign document" })).toBeDisabled();
	// Only vectors are submitted: no raster in any form value.
	const values = await page.locator("form input").evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value).join(""));
	expect(values).not.toContain("data:image");
});

test("SU-FR-05 touch and pen pointers draw too, and strokes accumulate", async ({ page }) => {
	await page.goto("/e2e/ceremony");
	await drawWith(page, "touch", 11, 0.1);
	await drawWith(page, "pen", 12, 0.5);
	expect((await value(page))?.strokes).toHaveLength(2);
	// The page does not scroll or zoom under a finger.
	expect(await page.getByTestId("sign-pad").evaluate((el) => getComputedStyle(el).touchAction)).toBe("none");
});

test("SU-FR-05 Undo and Clear work from the keyboard", async ({ page }) => {
	await page.goto("/e2e/ceremony");
	const undo = page.getByRole("button", { name: "Undo" });
	const clear = page.getByRole("button", { name: "Clear" });
	await expect(undo).toBeDisabled();
	await drawWith(page, "mouse", 1, 0.1);
	await drawWith(page, "mouse", 2, 0.5);
	await expect(undo).toBeEnabled();
	await undo.focus();
	await page.keyboard.press("Enter");
	expect((await value(page))?.strokes).toHaveLength(1);
	await clear.focus();
	await page.keyboard.press("Space");
	expect(await value(page)).toBeNull();
	await expect(clear).toBeDisabled();
});

test("SU-FR-05 the typed name stays required and the pad is optional", async ({ page }) => {
	await page.goto("/e2e/ceremony");
	await drawWith(page, "mouse", 1);
	await page.getByLabel("Company").fill("Acme");
	await page.getByRole("checkbox").nth(0).check();
	await page.getByRole("checkbox").nth(1).check();
	await expect(page.getByRole("button", { name: "Sign document" })).toBeDisabled();
	await page.getByLabel("Type your full name to sign").fill("Ada Lovelace");
	await expect(page.getByRole("button", { name: "Sign document" })).toBeEnabled();
});

test("SU-NFR-02 the pad script runs under the CSP with no violations", async ({ page }) => {
	await page.addInitScript(() => {
		(window as unknown as { __csp: string[] }).__csp = [];
		document.addEventListener("securitypolicyviolation", (e) =>
			(window as unknown as { __csp: string[] }).__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
		);
	});
	await page.goto("/e2e/ceremony");
	await drawWith(page, "mouse", 1);
	expect(await value(page)).not.toBeNull();
	expect(await page.evaluate(() => (window as unknown as { __csp: string[] }).__csp)).toEqual([]);
});

test("SU-FR-05 without JavaScript there is no pad and signing with a typed name still works", async ({ browser }) => {
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto("/e2e/ceremony");
	await expect(page.getByTestId("sign-pad")).toHaveCount(0);
	await expect(page.getByTestId("sign-pad-slot")).toBeAttached();
	await expect(page.getByLabel("Type your full name to sign")).toBeVisible();
	await expect(page.getByRole("button", { name: "Sign document" })).toBeEnabled();
	await context.close();
});
