import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
	handleSelfServeForm,
	handleStartRequest,
	loadSelfServe,
	readStartState,
	startMessage,
} from "../../src/astro/lib/self-serve";
import { esignIntegration } from "../../src/integration/index";
import { createPlugin } from "../../src/ui/index";

const root = resolve(import.meta.dirname, "../..");
const url = new URL("https://site.example/consent");

interface Seen {
	path: string;
	body: unknown;
}

/** A fake in-process handler; `reply` is what the core's route answers (sandboxed refusals are `{ ok: false }`). */
function host(reply: Record<string, unknown>) {
	const seen: Seen[] = [];
	const handler = async (_id: string, method: string, path: string, request: Request) => {
		seen.push({ path, body: method === "POST" ? await request.clone().json() : undefined });
		return { success: true, data: reply };
	};
	return { seen, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never };
}

function form(entries: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(entries)) data.set(k, v);
	return data;
}

const described = {
	ok: true,
	template: { id: "t1", name: "Photo consent", fields: ["phone"] },
	turnstileSiteKey: "0xSITE",
};

describe("the esign-request block loads its template (ES-FR-18, SU-FR-12)", () => {
	it("ES-FR-18 asks public/self-serve/start to describe the template and returns the form's fields", async () => {
		const h = host(described);
		const view = await loadSelfServe({ locals: h.locals, url }, { templateId: " t1 " });
		expect(view).toEqual({ state: "ready", template: described.template, turnstileSiteKey: "0xSITE" });
		expect(h.seen).toEqual([{ path: "public/self-serve/start", body: { templateId: "t1", describe: true } }]);
	});

	it("SU-FR-12 on Free, where the route is a NOT_FOUND stub, the block is unavailable and shows no form", async () => {
		const h = host({ ok: false, error: { code: "NOT_FOUND", message: "Not found" } });
		expect(await loadSelfServe({ locals: h.locals, url }, { templateId: "t1" })).toEqual({ state: "unavailable" });
	});

	it("a block with no template calls nothing and is unavailable", async () => {
		const h = host(described);
		expect(await loadSelfServe({ locals: h.locals, url }, { templateId: "  " })).toEqual({ state: "unavailable" });
		expect(h.seen).toHaveLength(0);
	});
});

describe("the start form post (ES-FR-18)", () => {
	const good = {
		templateId: "t1",
		returnTo: "/consent?x=1",
		name: " Ada Lovelace ",
		email: "ada@example.com",
		"field:phone": "0123",
		"cf-turnstile-response": "ts",
		website: "",
	};

	it("ES-FR-18 posts the visitor's details and redirects back with a sent notice, never a link", async () => {
		const h = host({ ok: true, status: "check_email" });
		const out = await handleSelfServeForm({ locals: h.locals, url }, form(good), {});
		expect(h.seen[0]?.body).toEqual({
			templateId: "t1",
			name: "Ada Lovelace",
			email: "ada@example.com",
			fields: { phone: "0123" },
			turnstileToken: "ts",
			website: "",
		});
		expect(out).toEqual({ location: "/consent?x=1&esign_start=sent&esign_t=t1#esign-request-t1" });
	});

	it("ES-FR-18 a refusal goes back to the page with its code (and the values are not echoed)", async () => {
		const h = host({ ok: false, error: { code: "TURNSTILE_FAILED", message: "no" } });
		const out = await handleSelfServeForm({ locals: h.locals, url }, form(good), {});
		expect(out).toEqual({ location: "/consent?x=1&esign_start=TURNSTILE_FAILED&esign_t=t1#esign-request-t1" });
		expect(JSON.stringify(out)).not.toContain("ada@example.com");
	});

	it("a returnTo on another site is ignored", async () => {
		const h = host({ ok: true, status: "check_email" });
		const out = await handleSelfServeForm(
			{ locals: h.locals, url },
			form({ ...good, returnTo: "https://evil.example/x" }),
			{},
		);
		expect("location" in out && out.location.startsWith("/")).toBe(true);
		expect("location" in out && out.location).not.toContain("evil");
	});

	it("a post with no template id is refused before the core is called", async () => {
		const h = host({ ok: true });
		const out = await handleSelfServeForm({ locals: h.locals, url }, form({ name: "x" }), {});
		expect(h.seen).toHaveLength(0);
		expect(out).toMatchObject({ message: expect.any(String) });
	});

	it("a cross-site post is refused with 403 before anything is read or called", async () => {
		const h = host({ ok: true });
		const request = new Request("https://site.example/_esign/start", {
			method: "POST",
			headers: { "sec-fetch-site": "cross-site" },
			body: new URLSearchParams(good),
		});
		const redirect = (location: string) => new Response(null, { status: 303, headers: { location } });
		const res = await handleStartRequest({ request, url, locals: h.locals, redirect }, {});
		expect(res.status).toBe(403);
		expect(h.seen).toHaveLength(0);
	});

	it("a same-site post answers 303", async () => {
		const h = host({ ok: true, status: "check_email" });
		const request = new Request("https://site.example/_esign/start", {
			method: "POST",
			headers: { "sec-fetch-site": "same-origin" },
			body: new URLSearchParams(good),
		});
		const redirect = (location: string) => new Response(null, { status: 303, headers: { location } });
		const res = await handleStartRequest({ request, url, locals: h.locals, redirect }, {});
		expect(res.status).toBe(303);
	});
});

describe("the notice after a post", () => {
	it("reads the state for its own template only", () => {
		const u = new URL("https://site.example/consent?esign_start=sent&esign_t=t1");
		expect(readStartState(u, "t1")).toEqual({ sent: true });
		expect(readStartState(u, "t2")).toEqual({ sent: false });
		expect(readStartState(new URL("https://s.example/?esign_start=RATE_LIMITED&esign_t=t1"), "t1")).toEqual({
			sent: false,
			code: "RATE_LIMITED",
		});
	});

	it("has plain wording for each refusal and an unknown code", () => {
		for (const code of ["TURNSTILE_FAILED", "RATE_LIMITED", "SELF_SERVE_FULL", "BAD_REQUEST", "TEMPLATE_NOT_FOUND"]) {
			expect(startMessage(code)).not.toBe(startMessage("SOMETHING_ELSE"));
		}
	});
});

describe("wiring (SU-FR-12)", () => {
	it("the integration injects the POST endpoint /_esign/start, server-rendered", async () => {
		const routes: Array<{ pattern: string; prerender?: boolean }> = [];
		await esignIntegration().hooks["astro:config:setup"]({
			injectRoute: (r: { pattern: string; prerender?: boolean }) => routes.push(r),
			updateConfig: () => undefined,
		});
		const start = routes.find((r) => r.pattern === "/_esign/start");
		expect(start?.prerender).toBe(false);
	});

	it("the UI plugin declares the esign-request editor block and the Astro entry renders it", () => {
		const blocks = (createPlugin() as { admin?: { portableTextBlocks?: Array<{ type: string }> } }).admin
			?.portableTextBlocks;
		expect(blocks?.map((b) => b.type)).toEqual(["esign-request"]);
		expect(readFileSync(resolve(root, "src/astro/index.js"), "utf8")).toMatch(/"esign-request":\s*SelfServeBlock/);
	});

	it("the block has a honeypot, a Turnstile widget slot and renders nothing from data as HTML", () => {
		const block = readFileSync(resolve(root, "src/astro/SelfServeBlock.astro"), "utf8");
		expect(block).toContain('name="website"');
		expect(block).toContain("cf-turnstile");
		expect(block).not.toMatch(/set:html|innerHTML/);
		expect(block).not.toContain("@semics-tech/shared");
	});

	it("the endpoint is exported by the package", () => {
		const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")) as { exports: Record<string, unknown> };
		expect(pkg.exports).toHaveProperty(["./astro/self-serve-endpoint"]);
		expect(pkg.exports).toHaveProperty(["./astro/SelfServeBlock.astro"]);
	});
});
