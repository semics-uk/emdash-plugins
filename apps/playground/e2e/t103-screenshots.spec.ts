import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { type Browser, expect, test } from "@playwright/test";

import { createAndSend } from "./harness/esign-journey";

// T103: the registry listing images (icon, banner, screenshots) of both Free cores, made from the
// running playground so they show the real UI. Every run takes them and checks their size; with
// T103_WRITE=1 they are also written to packages/<core>/listing/ (commit the result):
//
//   T103_WRITE=1 corepack pnpm@10.23.0 --filter playground e2e -- e2e/t103-screenshots.spec.ts
//
// apps/docs/tests/listing.test.mjs fails when a listing names an image this spec does not make.

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WRITE = process.env.T103_WRITE === "1";
const SHOT = { width: 1280, height: 800 };

function save(core: "events" | "esign", name: string, png: Buffer) {
	if (!WRITE) return;
	const file = resolve(repo, "packages", core, "listing", name);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, png);
}

/** Width and height from a PNG's IHDR chunk. */
const size = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/** A 1280x800 screenshot of `path`. */
async function shoot(browser: Browser, path: string) {
	const context = await browser.newContext({ viewport: SHOT, deviceScaleFactor: 1, colorScheme: "light" });
	const page = await context.newPage();
	await page.goto(path);
	await page.waitForLoadState("load");
	// Let late content settle (fonts, the Turnstile box), without waiting on its network.
	await page.waitForTimeout(1500);
	const png = await page.screenshot();
	await context.close();
	expect(size(png)).toEqual(SHOT);
	return png;
}

/** An image drawn from HTML at an exact size (icon and banner). */
async function draw(browser: Browser, width: number, height: number, html: string) {
	const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
	const page = await context.newPage();
	await page.setContent(`<!doctype html><html><body style="margin:0">${html}</body></html>`);
	const png = await page.screenshot();
	await context.close();
	expect(size(png)).toEqual({ width, height });
	return png;
}

const TICKET =
	'<path d="M40 70h176v34a22 22 0 0 0 0 44v34H40v-34a22 22 0 0 0 0-44z" fill="#fff"/><path d="M150 82v92" stroke="#1f5fbf" stroke-width="8" stroke-dasharray="12 10"/><path d="M70 104h52M70 128h40M70 152h52" stroke="#1f5fbf" stroke-width="10" stroke-linecap="round"/>';
const PEN =
	'<path d="M64 192c30-6 52-16 70-34l58-58-26-26-58 58c-18 18-28 40-34 70z" fill="#fff"/><path d="M166 74l26 26 18-18a8 8 0 0 0 0-11l-15-15a8 8 0 0 0-11 0z" fill="#fff"/><path d="M60 214h136" stroke="#fff" stroke-width="10" stroke-linecap="round"/>';

const icon = (colour: string, glyph: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="48" fill="${colour}"/>${glyph}</svg>`;

const banner = (colour: string, glyph: string, title: string, line: string) => `
<div style="width:1280px;height:400px;background:${colour};color:#fff;display:flex;align-items:center;gap:56px;padding:0 96px;box-sizing:border-box;font-family:system-ui,sans-serif">
	<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 256 256">${glyph}</svg>
	<div><div style="font-size:64px;font-weight:700;letter-spacing:-1px">${title}</div>
	<div style="font-size:30px;margin-top:12px;opacity:.92">${line}</div>
	<div style="font-size:22px;margin-top:28px;opacity:.8">A free, open-source plugin for EmDash</div></div>
</div>`;

const EVENTS_BLUE = "#1f5fbf";
const ESIGN_GREEN = "#17694a";

test("T103 events listing: icon, banner and screenshots of the booking widget and the events list", async ({
	browser,
}) => {
	test.setTimeout(120_000);
	save("events", "icon.png", await draw(browser, 256, 256, icon(EVENTS_BLUE, TICKET)));
	const eventsBanner = banner(EVENTS_BLUE, TICKET, "semics Events", "Tickets, bookings and waitlists");
	save("events", "banner.png", await draw(browser, 1280, 400, eventsBanner));
	save("events", "screenshots/1-booking-form.png", await shoot(browser, "/events/nyc-workshop"));
	save("events", "screenshots/2-events-list.png", await shoot(browser, "/whats-on"));
});

test("T103 esign listing: icon, banner and screenshots of the signing page, the signed state and /verify", async ({
	browser,
	request,
}) => {
	test.setTimeout(120_000);
	const sent = await createAndSend(request, "Venue hire agreement");
	save("esign", "icon.png", await draw(browser, 256, 256, icon(ESIGN_GREEN, PEN)));
	const esignBanner = banner(ESIGN_GREEN, PEN, "semics E-sign", "Simple electronic signatures with an audit trail");
	save("esign", "banner.png", await draw(browser, 1280, 400, esignBanner));
	save("esign", "screenshots/1-signing-page.png", await shoot(browser, `/sign/${sent.token}`));
	save("esign", "screenshots/2-signed.png", await shoot(browser, "/e2e/ceremony?state=signed"));
	save("esign", "screenshots/3-verify.png", await shoot(browser, "/verify"));
});
