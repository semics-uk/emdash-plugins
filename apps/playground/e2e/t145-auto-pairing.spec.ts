import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

// @ts-expect-error plain .mjs without types
import { ADMIN_TOKEN } from "./harness/esign-admin.mjs";
import { route } from "./harness/esign-journey";

// T145: on a site with Events, E-sign and the suite, an administrator pairs Events with E-sign from
// `/_events/pair` with one click: no master key to generate, no string to copy. The pairing string
// goes from E-sign to Events' encrypted setting on the server and never reaches the browser.

test.describe.configure({ mode: "serial" });

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const admin = { authorization: `Bearer ${ADMIN_TOKEN}`, "x-emdash-request": "1" };
const PAIRING = /esign1\.[A-Za-z0-9_-]{4,64}\.[A-Za-z0-9_-]{43}/;

/** Signs the browser context in as the seeded admin through the real magic-link flow (mail capture). */
async function signIn(page: Page, baseURL: string) {
	const origin = { origin: baseURL, "x-forwarded-for": "198.51.100.145" };
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

async function eventsPaired(request: APIRequestContext): Promise<boolean> {
	const res = await request.get("/_emdash/api/admin/plugins/semics-events/settings", { headers: admin });
	const body = (await res.json()) as { data?: { secretsSet?: Record<string, boolean> } };
	return body.data?.secretsSet?.esignPairing === true;
}

/** The site client rows E-sign holds (the clients collection; no secret is stored there). */
function siteClients(): Array<{ clientId: string; revokedAt: string | null }> {
	const db = new DatabaseSync(resolve(root, "data.db"), { readOnly: true });
	try {
		return (
			db
				.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = 'semics-esign' AND collection = 'clients'")
				.all() as Array<{ data: string }>
		)
			.map((row) => JSON.parse(row.data) as { name: string; clientId: string; revokedAt: string | null })
			.filter((c) => c.name === "Events on this site");
	} finally {
		db.close();
	}
}

test("T145 a fresh site reaches paired with one admin click; the pairing string never reaches the browser", async ({
	page,
	baseURL,
}) => {
	const bodies: string[] = [];
	page.on("response", async (res) => {
		bodies.push(`${res.url()} ${JSON.stringify(await res.allHeaders())} ${await res.text().catch(() => "")}`);
	});

	// Signed out: refused, nothing changes.
	const anonymous = await page.goto("/_events/pair");
	expect(anonymous?.status()).toBe(403);
	await expect(page.getByTestId("pair-forbidden")).toBeVisible();

	await signIn(page, baseURL as string);
	await page.goto("/_events/pair");
	await expect(page.getByTestId("pair-page")).toHaveAttribute("data-state", "unpaired");
	expect(await eventsPaired(page.request)).toBe(false);

	await page.getByTestId("pair-button").click(); // the one click
	await expect(page.getByTestId("pair-done")).toContainText("Paired");
	await expect(page.getByTestId("pair-page")).toHaveAttribute("data-state", "paired");
	expect(await eventsPaired(page.request)).toBe(true);
	expect(siteClients().filter((c) => c.revokedAt === null)).toHaveLength(1);
	expect(page.url()).not.toMatch(/esign1/);
	expect(bodies.filter((b) => PAIRING.test(b))).toEqual([]);

	// The session cookie is `Secure`, which Chrome sends to 127.0.0.1 but Playwright's API client does
	// not, so the replays below run in the page, as the admin's browser would send them.
	const post = (url: string, body: string, type: string, headers: Record<string, string> = {}) =>
		page.evaluate(
			async ([u, b, t, h]) => {
				const res = await fetch(u as string, {
					method: "POST",
					body: b as string,
					headers: { "content-type": t as string, ...(h as Record<string, string>) },
				});
				return { status: res.status, text: await res.text() };
			},
			[url, body, type, headers] as const,
		);

	// Re-running pairing (a replayed post) keeps the one client.
	const again = await post("/_events/pair", "action=pair", "application/x-www-form-urlencoded");
	expect(again.status, again.text).toBe(200);
	expect(again.text).not.toMatch(PAIRING);
	expect(again.text).toContain('data-state="paired"');
	expect(siteClients()).toHaveLength(1);

	// A cross-site post is refused.
	const forged = await page.request.post("/_events/pair", {
		form: { action: "unpair" },
		headers: { origin: "https://evil.example" },
	});
	expect(forged.status()).toBe(403);
	expect(await eventsPaired(page.request)).toBe(true);

	// E-sign refuses to hand the pairing string to a browser, even a signed-in administrator's.
	const direct = await post(
		"/_emdash/api/plugins/semics-esign/integrations/pair",
		JSON.stringify({ action: "pair" }),
		"application/json",
		{ "x-emdash-request": "1" },
	);
	expect(direct.text).not.toMatch(PAIRING);
	expect(direct.text).toContain("SERVER_ONLY");
	expect(siteClients()).toHaveLength(1);

	await page.goto("/_events/pair");
	// Unpairing leaves Events asking for a pairing again.
	await page.getByTestId("unpair-button").click();
	await expect(page.getByTestId("pair-done")).toContainText("Unpaired");
	await expect(page.getByTestId("pair-page")).toHaveAttribute("data-state", "unpaired");
	expect(await eventsPaired(page.request)).toBe(false);
	expect(siteClients().every((c) => c.revokedAt !== null)).toBe(true);
});

/** Every client row E-sign holds with one of these names, active or not. */
function clientsNamed(...names: string[]): Array<{ name: string; clientId: string; revokedAt: string | null }> {
	const db = new DatabaseSync(resolve(root, "data.db"), { readOnly: true });
	try {
		return (
			db
				.prepare("SELECT data FROM _plugin_storage WHERE plugin_id = 'semics-esign' AND collection = 'clients'")
				.all() as Array<{ data: string }>
		)
			.map((row) => JSON.parse(row.data) as { name: string; clientId: string; revokedAt: string | null })
			.filter((c) => names.includes(c.name));
	} finally {
		db.close();
	}
}

test("T149 a hand-made pairing shows as paired, and pairing again keeps that one client", async ({ page, baseURL }) => {
	const bodies: string[] = [];
	page.on("response", async (res) => {
		bodies.push(`${res.url()} ${JSON.stringify(await res.allHeaders())} ${await res.text().catch(() => "")}`);
	});
	// The admin pairs by hand (T060): a client made on E-sign's Integrations page, its string pasted into Events.
	await route(page.request, "admin", { type: "block_action", action_id: "integrations.generate-key" }, true).catch(
		() => null,
	);
	const created = await route(
		page.request,
		"admin",
		{ type: "form_submit", action_id: "client.create", values: { name: "Events by hand", returnUrlAllowlist: "" } },
		true,
	);
	const pairing = PAIRING.exec(JSON.stringify(created))?.[0] as string;
	expect(pairing).toBeDefined();
	const [, handId, secret] = pairing.split(".") as [string, string, string];
	const saved = await page.request.put("/_emdash/api/admin/plugins/semics-events/settings", {
		headers: admin,
		data: { values: { esignPairing: pairing } },
	});
	expect(saved.ok(), await saved.text()).toBe(true);
	bodies.length = 0;

	await signIn(page, baseURL as string);
	await page.goto("/_events/pair");
	await expect(page.getByTestId("pair-page")).toHaveAttribute("data-state", "paired");
	await expect(page.getByTestId("pair-status")).toContainText("is paired");

	// Pairing again (a replayed post) adopts the hand-made client: no second client, nothing left unused.
	const again = await page.evaluate(async () => {
		const res = await fetch("/_events/pair", {
			method: "POST",
			body: "action=pair",
			headers: { "content-type": "application/x-www-form-urlencoded" },
		});
		return { status: res.status, text: await res.text() };
	});
	expect(again.status, again.text).toBe(200);
	expect(again.text).toContain('data-state="paired"');
	const active = clientsNamed("Events by hand", "Events on this site").filter((c) => c.revokedAt === null);
	expect(active.map((c) => c.clientId)).toEqual([handId]);
	expect(await eventsPaired(page.request)).toBe(true);
	expect(bodies.filter((b) => b.includes(secret))).toEqual([]);

	// Unpairing revokes the client Events used.
	await page.goto("/_events/pair");
	await page.getByTestId("unpair-button").click();
	await expect(page.getByTestId("pair-page")).toHaveAttribute("data-state", "unpaired");
	expect(clientsNamed("Events by hand").every((c) => c.revokedAt !== null)).toBe(true);
});

test("T150 the templates page links back to the events, and the pair page refreshes templates in one step", async ({
	page,
	baseURL,
}) => {
	// The page the panel's Refresh link opens: whatever happened, it says where to go next and links back.
	await page.goto("/_events/templates");
	await expect(page.getByTestId("templates-back")).toHaveAttribute("href", "/_emdash/admin/content/events");

	await signIn(page, baseURL as string);
	await page.goto("/_events/pair");
	await page.getByTestId("pair-button").click();
	await expect(page.getByTestId("pair-page")).toHaveAttribute("data-state", "paired");
	// Paired: templates added in E-sign later are fetched from here with one click, no link to follow.
	await page.getByTestId("templates-button").click();
	await expect(page.getByTestId("pair-page")).toHaveAttribute("data-state", "paired");
	// The playground runs Free Events, which has no template catalogue: the page says so plainly.
	await expect(page.getByTestId("pair-templates")).toContainText("Events Pro");
	await page.getByTestId("unpair-button").click();
	await expect(page.getByTestId("pair-page")).toHaveAttribute("data-state", "unpaired");
});
