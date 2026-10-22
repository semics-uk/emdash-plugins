import { createHmac, randomInt } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";

import { route } from "./harness/esign-journey";

// T067, the Phase 3 gate, on the real playground (Free Events + Free E-sign wired by `eventsSuite()`).
// The playground cannot load Pro (R40), so "a waiver-required booking cannot confirm without receipts"
// and the forgery/replay/downgrade attacks across both cores run in the Pro repo, on both real bundles
// in workerd (`events-pro/tests/integration.editions.test.ts`). Here, in a real browser and server:
// every integration page refuses cross-site posts (EmDash turns Astro's origin check off), the door
// page carries its intent only in the fragment and a POST, a used door intent cannot be reused, and
// the waiver page's "Try again" reaches the booking's access token on its own path.

test.describe.configure({ mode: "serial" });

const EVENTS = "/_emdash/api/plugins/semics-events";
const visitor = () => ({ "x-forwarded-for": `198.51.100.${randomInt(1, 250)}` });

async function eventsRoute<T>(request: APIRequestContext, path: string, body: unknown): Promise<T> {
	const response = await request.post(`${EVENTS}/${path}`, {
		data: body,
		headers: { "x-emdash-request": "1", ...visitor() },
	});
	const reply = (await response.json()) as { data?: T };
	return reply.data as T;
}

/** Pairs an integration client and creates a template flagged for integrations (as T065's spec). */
async function pairAndTemplate(request: APIRequestContext, baseURL: string) {
	await route(request, "admin", { type: "block_action", action_id: "integrations.generate-key" }, true).catch(
		() => null,
	);
	const created = await route(
		request,
		"admin",
		{ type: "form_submit", action_id: "client.create", values: { name: "Door", returnUrlAllowlist: `${baseURL}/booking` } },
		true,
	);
	const pairing = /esign1\.([A-Za-z0-9_-]{4,64})\.([A-Za-z0-9_-]{43})/.exec(JSON.stringify(created));
	expect(pairing).not.toBeNull();
	const { template } = await route<{ template: { id: string } }>(
		request,
		"templates/create",
		{ name: "Door waiver", body: "# Waiver\n\nI, {{signer.name}}, accept the risks.\n", integrations: true },
		true,
	);
	return { cid: pairing?.[1] as string, secret: Buffer.from(pairing?.[2] as string, "base64url"), tpl: template.id };
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const newRef = () => Array.from({ length: 10 }, () => CROCKFORD[randomInt(32)]).join("");

test("T067 SX-NFR-02 cross-site posts to every integration page are refused with 403", async ({ request }) => {
	const ref = newRef();
	const pages: Array<[string, Record<string, string>]> = [
		[`/_events/waiver?ref=${ref}`, { intent: "retry" }],
		[`/_events/waiver`, { intent: "book", eventId: "x" }],
		["/_events/sign", { intent: "a.b" }],
		["/_events/templates", { catalog: "a.b" }],
		[`/booking?ref=${ref}`, { intent: "receipt", receipt: "a.b" }],
	];
	for (const headers of [{ origin: "https://evil.example" }, { "sec-fetch-site": "cross-site" }]) {
		for (const [path, form] of pages) {
			const response = await request.post(path, { form, headers, maxRedirects: 0 });
			expect(response.status(), `${path} ${JSON.stringify(headers)}`).toBe(403);
		}
	}
});

test("T067 EV-FR-12 the door page moves its intent from the fragment into a POST; a used intent is refused", async ({
	page,
	request,
	baseURL,
}) => {
	const { cid, secret, tpl } = await pairAndTemplate(request, baseURL as string);
	const ref = newRef();
	const now = Math.floor(Date.now() / 1000);
	// The intent Events Pro's check-in mints for a pending adult (T064 `doorSigningLink`): inline, self.
	const payload = Buffer.from(
		JSON.stringify({
			v: 1,
			typ: "intent",
			cid,
			iat: now,
			exp: now + 900,
			nonce: `t067door${Date.now()}`,
			tpl,
			ref: `${ref}:3`,
			signer: { name: "Charles Babbage", email: `charles.${Date.now()}@example.com` },
			as: "self",
			delivery: "inline",
			prefill: {},
			returnUrl: `${baseURL}/booking?ref=${ref}`,
		}),
	).toString("base64url");
	const intent = `${payload}.${createHmac("sha256", secret).update(`esign-intent/1.${payload}`).digest("base64url")}`;

	const urls: string[] = [];
	const referers: string[] = [];
	page.on("request", (r) => {
		urls.push(r.url());
		const referer = r.headers().referer;
		if (referer) referers.push(referer);
	});
	const door = await page.goto(`/_events/sign#intent=${intent}`);
	expect(door?.headers()["referrer-policy"]).toBe("no-referrer");
	// The script posts the fragment's intent; the page redeems it with e-sign and opens the ceremony.
	await page.waitForURL(/\/sign\/[A-Za-z0-9_-]+$/);
	await expect(page.getByTestId("signing-ceremony")).toHaveAttribute("data-state", "ready");
	for (const url of [...urls, ...referers]) expect(url).not.toContain(payload);

	// Opening the same link again (a copied link, the back button): the nonce is spent.
	await page.goto(`/_events/sign#intent=${intent}`);
	await expect(page.getByTestId("door-sign-error")).toContainText("already used");
});

test("T067 SX-FR-03 'Try again' on the waiver page reaches the booking's access token on that page's path", async ({
	browser,
	baseURL,
	request,
}) => {
	const listing = (await (await request.get(`${EVENTS}/public/events`)).json()) as {
		data: { events: Array<{ slug: string; eventId: string }> };
	};
	const eventId = listing.data.events.find((e) => e.slug === "london-meetup")?.eventId as string;
	const held = await eventsRoute<{ bookingRef: string; accessToken: string }>(request, "public/checkout/reserve", {
		eventId,
		lines: [{ ticketTypeId: "tt_london_general", qty: 1 }],
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		idempotencyKey: `t067-retry-${Date.now()}-${"k".repeat(16)}`,
	});
	expect(held.bookingRef).toMatch(/^[0-9A-Z]{10}$/);

	// What `/_events/waiver` leaves when e-sign refuses an intent: the booking cookie (Path=/booking,
	// which the browser never sends here) and the retry copy on the waiver page's own path.
	const context = await browser.newContext({ javaScriptEnabled: false, extraHTTPHeaders: visitor() });
	const domain = new URL(baseURL as string).hostname;
	await context.addCookies([
		{ name: `semics_booking_${held.bookingRef}`, value: held.accessToken, domain, path: "/booking", httpOnly: true, sameSite: "Lax" },
		{
			name: `semics_waiver_access_${held.bookingRef}`,
			value: held.accessToken,
			domain,
			path: "/_events/waiver",
			httpOnly: true,
			sameSite: "Strict",
		},
	]);
	const page = await context.newPage();
	await page.goto(`/_events/waiver?ref=${held.bookingRef}&error=SIGNING_UNAVAILABLE`);
	await page.getByTestId("waiver-retry").getByRole("button", { name: "Try again" }).click();
	// Free Events has no signature step, so continuing the held booking confirms it.
	await expect(page).toHaveURL(new RegExp(`/booking\\?ref=${held.bookingRef}$`));
	await expect(page.getByTestId("booking-status")).toHaveAttribute("data-status", "confirmed");
	expect(page.url()).not.toContain(held.accessToken);
	await context.close();
});
