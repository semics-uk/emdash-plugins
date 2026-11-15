import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

import { admin, createEvent, EVENTS, saveSettings } from "./harness/pro";
import { hasVouchers, requireVouchers } from "./harness/vouchers";

// T172: on a site with Events Pro, Vouchers Pro and the suite, an administrator pairs Events with Vouchers from
// `/_events/pair#vouchers` with one click: no string to copy from Vouchers' admin and paste into Events' settings.
// A string pasted with a trailing line break (what Events Pro cannot parse) is reported, with its reason, and the
// one click replaces it. The pairing string never reaches the browser. Skipped on the Free build (CI).

test.describe.configure({ mode: "serial" });

const SECRET_PART = /voucher1\.[A-Za-z0-9_-]{4,64}\.[A-Za-z0-9_-]{43}/;

/** Signs the browser context in as the seeded admin through the real magic-link flow (as in t145). */
async function signIn(page: Page, baseURL: string) {
	const origin = { origin: baseURL, "x-forwarded-for": "198.51.100.172" };
	const sent = await page.request.post("/_emdash/api/auth/magic-link/send", {
		data: { email: "admin@example.com" },
		headers: origin,
	});
	expect(sent.ok(), await sent.text()).toBe(true);
	let token: string | undefined;
	for (let i = 0; i < 20 && !token; i++) {
		const { messages } = (await (await page.request.get("/e2e/mail?to=admin%40example.com")).json()) as {
			messages: Array<{ text?: string; html?: string }>;
		};
		const last = messages.at(-1);
		token = /[?&]token=([A-Za-z0-9_-]+)/.exec(`${last?.text ?? ""} ${last?.html ?? ""}`)?.[1];
		if (!token) await page.waitForTimeout(250);
	}
	expect(token, "magic link token").toBeDefined();
	const verified = await page.request.post("/_emdash/api/auth/magic-link/verify", { data: { token }, headers: origin });
	expect(verified.ok(), await verified.text()).toBe(true);
}

/** Whether Events Pro's `public/event` offers the Gift voucher code (it does once the pairing parses). */
async function offersVouchers(request: APIRequestContext, eventId: string): Promise<boolean> {
	const res = await request.get(`${EVENTS}/public/event?eventId=${encodeURIComponent(eventId)}`);
	const body = (await res.json()) as { data?: { vouchers?: boolean } };
	return body.data?.vouchers === true;
}

test("T172 one click pairs Events with Vouchers; a pasted string with a line break is explained and replaced", async ({
	page,
	baseURL,
	request,
}) => {
	await requireVouchers(request);
	expect(await hasVouchers(request)).toBe(true);
	const eventId = await createEvent(request, {
		slug: "t172-pairing",
		title: "Pairing check",
		startsAt: "2031-08-01T10:00:00.000Z",
		config: { status: "on_sale", capacity: 10, currency: "GBP", signature: { required: false } },
		ticketTypes: [{ name: "Place", priceMinor: 2000, capacity: 10, maxPerOrder: 2 }],
	});
	// What happened on staging: a string pasted with a line break after it, which Events Pro reads as is.
	const made = await request.post("/_emdash/api/plugins/semics-vouchers/pairing/create", { data: {}, headers: admin });
	const pasted = ((await made.json()) as { data?: { pairing?: string } }).data?.pairing;
	expect(pasted).toMatch(SECRET_PART);
	await saveSettings(request, { vouchersPairing: `${pasted}\n` });
	expect(await offersVouchers(request, eventId)).toBe(false);

	const bodies: string[] = [];
	page.on("response", async (res) => {
		bodies.push(`${res.url()} ${JSON.stringify(await res.allHeaders())} ${await res.text().catch(() => "")}`);
	});
	await signIn(page, baseURL as string);
	await page.goto("/_events/pair");
	const section = page.getByTestId("vouchers-pair");
	await expect(section).toHaveAttribute("data-state", "rejected");
	await expect(page.getByTestId("vouchers-pair-status")).toContainText("line break");

	await page.getByTestId("vouchers-pair-button").click(); // the one click
	await expect(page.getByTestId("vouchers-pair-done")).toContainText("Paired");
	await expect(section).toHaveAttribute("data-state", "paired");
	expect(page.url()).toMatch(/#vouchers$/);
	expect(await offersVouchers(request, eventId)).toBe(true);
	// The pairing string was never in a response the browser saw (the page shows only client ids).
	expect(bodies.filter((b) => SECRET_PART.test(b))).toEqual([]);

	// Vouchers' admin pressing "Pair again" leaves Events on an older client: the page says so, one click fixes it.
	await request.post("/_emdash/api/plugins/semics-vouchers/pairing/create", { data: {}, headers: admin });
	await page.goto("/_events/pair");
	await expect(section).toHaveAttribute("data-state", "stale");
	await page.getByTestId("vouchers-pair-button").click();
	await expect(section).toHaveAttribute("data-state", "paired");

	// A cross-site post is refused.
	const forged = await page.request.post("/_events/pair", {
		form: { action: "vouchers-pair" },
		headers: { origin: "https://evil.example" },
	});
	expect(forged.status()).toBe(403);
});
