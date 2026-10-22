import { describe, expect, it, vi } from "vitest";

import { callPublicRoute, ESIGN_PLUGIN_ID } from "../../src/astro/lib/call";
import { crossSiteResponse, isCrossSiteRequest } from "../../src/astro/lib/csrf";
import { ceremonyRedirect, handleSign, handleSignedCopy, handleVerify } from "../../src/astro/lib/sign";

const url = new URL("https://site.example/sign/TOKEN");
const DOC = "a".repeat(64);
const TOKEN = "T".repeat(43);

interface Seen {
	path: string;
	url: string;
	body: unknown;
}

type Reply = Record<string, unknown> | ((body: unknown) => Record<string, unknown>);

/** A fake in-process handler recording each request; `routes` maps a route path to its reply. */
function host(routes: Record<string, Reply>) {
	const seen: Seen[] = [];
	const handler = async (_id: string, method: string, path: string, request: Request) => {
		const body = method === "POST" ? await request.clone().json() : undefined;
		seen.push({ path, url: request.url, body });
		const reply = routes[path];
		const data = typeof reply === "function" ? reply(body) : reply;
		return { success: true, data };
	};
	return { seen, ctx: { locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url } };
}

const ready = {
	ok: true,
	state: "ready",
	envelope: { id: "e1", title: "NDA", status: "in_progress", docSha256: DOC, expiresAt: null },
	signer: { name: "Ada", as: "Client" },
	snapshot: "Hello\n\nSign here",
	consent: { version: "1", wording: "I agree to sign electronically.", sha256: "c".repeat(64) },
};

function form(entries: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(entries)) data.set(k, v);
	return data;
}

const signForm = { intent: "sign", typedName: "Ada", consent: "on", agree: "on" };

describe("callPublicRoute (SU-FR-01, T055)", () => {
	it("defaults to the e-sign core and treats a refusal wrapped as success as an error", async () => {
		const h = host({ "public/session": { ok: false, error: { code: "SIGNING_TOKEN_INVALID", message: "no" } } });
		const result = await callPublicRoute(h.ctx, { method: "POST", path: "public/session", body: { token: TOKEN } });
		expect(result).toMatchObject({ ok: false, error: { code: "SIGNING_TOKEN_INVALID" } });
		expect(h.seen[0]?.url).toBe(`https://site.example/_emdash/api/plugins/${ESIGN_PLUGIN_ID}/public/session`);
	});
});

describe("callPublicRoute keeps the visitor's request metadata in-process (T034, ES-FR-05)", () => {
	function incoming() {
		const request = new Request("https://site.example/sign/TOKEN", {
			method: "POST",
			headers: {
				"user-agent": "Mozilla/5.0 Signer",
				"cf-connecting-ip": "203.0.113.9",
				"x-forwarded-for": "203.0.113.9",
				cookie: "emdash-session=secret",
				authorization: "Bearer secret",
				referer: "https://site.example/sign/TOKEN",
				"content-type": "application/x-www-form-urlencoded",
			},
			body: "a=b",
		});
		Object.defineProperty(request, "cf", { value: { country: "GB" } });
		return request;
	}

	it("forwards the user agent, the client IP headers and the cf object, never cookies, credentials or the Referer", async () => {
		const seen: Request[] = [];
		const handler = async (_id: string, _method: string, _path: string, request: Request) => {
			seen.push(request);
			return { success: true, data: { ok: true } };
		};
		const ctx = { locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url, request: incoming() };
		await callPublicRoute(ctx, { method: "POST", path: "public/session", body: { token: TOKEN } });
		const sent = seen[0] as Request & { cf?: unknown };
		expect(sent.headers.get("user-agent")).toBe("Mozilla/5.0 Signer");
		expect(sent.headers.get("cf-connecting-ip")).toBe("203.0.113.9");
		expect(sent.headers.get("x-forwarded-for")).toBe("203.0.113.9");
		expect(sent.cf).toEqual({ country: "GB" });
		for (const header of ["cookie", "authorization", "referer"]) expect(sent.headers.get(header), header).toBeNull();
		expect(sent.headers.get("content-type")).toBe("application/json");
		expect(await sent.json()).toEqual({ token: TOKEN });
	});

	it("handleSign and handleVerify pass the page request through", async () => {
		const seen: Request[] = [];
		const handler = async (_id: string, _method: string, path: string, request: Request) => {
			seen.push(request);
			return { success: true, data: path === "public/verify" ? { ok: true, matched: false } : ready };
		};
		const ctx = { locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url, request: incoming() };
		await handleSign(ctx, TOKEN, null);
		await handleVerify(ctx, form({ sha256: DOC }));
		expect(seen.map((r) => r.headers.get("user-agent"))).toEqual(["Mozilla/5.0 Signer", "Mozilla/5.0 Signer"]);
	});
});

describe("isCrossSiteRequest: the UI's own CSRF check (T034; EmDash sets Astro checkOrigin off)", () => {
	const page = new URL("http://localhost/sign/TOKEN");
	const post = (headers: Record<string, string>, method = "POST") =>
		new Request("https://sign.example/sign/TOKEN", { method, headers });

	it("trusts Sec-Fetch-Site first", () => {
		expect(isCrossSiteRequest(post({ "sec-fetch-site": "cross-site" }), page)).toBe(true);
		expect(isCrossSiteRequest(post({ "sec-fetch-site": "same-site" }), page)).toBe(true);
		expect(isCrossSiteRequest(post({ "sec-fetch-site": "same-origin", origin: "https://evil.example" }), page)).toBe(
			false,
		);
		expect(isCrossSiteRequest(post({ "sec-fetch-site": "none" }), page)).toBe(false);
	});

	it("falls back to Origin against the page origin or the Host the browser sent", () => {
		expect(isCrossSiteRequest(post({ origin: "https://evil.example", host: "sign.example" }), page)).toBe(true);
		expect(isCrossSiteRequest(post({ origin: "https://sign.example", host: "sign.example" }), page)).toBe(false);
		expect(isCrossSiteRequest(post({ origin: "http://localhost" }), page)).toBe(false);
		expect(isCrossSiteRequest(post({ origin: "null", host: "sign.example" }), page)).toBe(true);
		expect(isCrossSiteRequest(post({}), page)).toBe(false);
	});

	it("never refuses a GET", () => {
		expect(isCrossSiteRequest(post({ "sec-fetch-site": "cross-site" }, "GET"), page)).toBe(false);
	});

	it("the refusal is a 403 that is never cached", () => {
		const res = crossSiteResponse();
		expect(res.status).toBe(403);
		expect(res.headers.get("cache-control")).toBe("no-store");
	});
});

describe("handleSign (SU-FR-01, SU-FR-02, R31)", () => {
	it("SU-FR-01 a GET calls public/session with the token in the POST body only", async () => {
		const h = host({ "public/session": ready });
		const view = await handleSign(h.ctx, TOKEN, null);
		expect(view.kind).toBe("ready");
		expect(h.seen).toHaveLength(1);
		expect(h.seen[0]?.body).toEqual({ token: TOKEN });
		expect(h.seen.every((s) => !s.url.includes(TOKEN))).toBe(true);
	});

	it("T031 every call (session, submit, decline, the re-read) uses the integration's configured plugin id", async () => {
		const ids: string[] = [];
		const routes: Record<string, unknown> = {
			"public/session": ready,
			"public/submit": { ok: true, status: "completed" },
			"public/decline": { ok: true },
		};
		const handler = async (id: string, _m: string, path: string) => {
			ids.push(id);
			return { success: true, data: routes[path] };
		};
		const ctx = { locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url, pluginId: "r_abc123" };
		await handleSign(ctx, TOKEN, form(signForm));
		await handleSign(ctx, TOKEN, form({ intent: "decline" }));
		expect(ids).toHaveLength(5);
		expect(new Set(ids)).toEqual(new Set(["r_abc123"]));
		ids.length = 0;
		await handleSign({ ...ctx, pluginId: undefined }, TOKEN, null);
		expect(ids).toEqual([ESIGN_PLUGIN_ID]);
	});

	it("T117 a GET (a mail scanner's prefetch) never opens the envelope; a sign or decline post opens it first", async () => {
		const h = host({
			"public/session": ready,
			"public/submit": { ok: true, status: "completed" },
			"public/decline": { ok: true, status: "declined" },
		});
		await handleSign(h.ctx, TOKEN, null);
		expect(h.seen.map((s) => s.body)).toEqual([{ token: TOKEN }]);
		h.seen.length = 0;
		await handleSign(h.ctx, TOKEN, form(signForm));
		expect(h.seen[0]).toMatchObject({ path: "public/session", body: { token: TOKEN, open: true } });
		expect(h.seen[1]?.path).toBe("public/submit");
		// The re-read after signing only looks.
		expect(h.seen[2]).toMatchObject({ path: "public/session", body: { token: TOKEN } });
		h.seen.length = 0;
		await handleSign(h.ctx, TOKEN, form({ intent: "decline" }));
		expect(h.seen.map((s) => [s.path, s.body])).toEqual([
			["public/session", { token: TOKEN, open: true }],
			["public/decline", { token: TOKEN }],
		]);
	});

	it("a bad token is a defined error view, not a throw", async () => {
		const h = host({ "public/session": { ok: false, error: { code: "SIGNING_TOKEN_INVALID", message: "x" } } });
		const view = await handleSign(h.ctx, TOKEN, null);
		expect(view).toMatchObject({ kind: "error", code: "SIGNING_TOKEN_INVALID" });
		expect(view.kind === "error" && view.message).toMatch(/link/i);
	});

	it("R31 submit calls the session first, then public/submit bound to the session's document hash", async () => {
		const h = host({
			"public/session": ready,
			"public/submit": { ok: true, status: "completed", completedAt: "2030-01-01T00:00:00Z" },
		});
		const view = await handleSign(h.ctx, TOKEN, form({ ...signForm, typedName: " Ada Lovelace " }));
		expect(h.seen.map((s) => s.path).slice(0, 2)).toEqual(["public/session", "public/submit"]);
		expect(h.seen[1]?.body).toEqual({
			token: TOKEN,
			docSha256: DOC,
			consentSha256: "c".repeat(64),
			consent: true,
			intent: true,
			signature: { kind: "typed", typedName: "Ada Lovelace" },
			fieldValues: {},
		});
		expect(view).toMatchObject({ kind: "signed" });
	});

	it("does not submit without consent and intent; it re-renders the ceremony with the fields to fix", async () => {
		const h = host({ "public/session": ready });
		const view = await handleSign(h.ctx, TOKEN, form({ intent: "sign", typedName: "Ada" }));
		expect(h.seen.map((s) => s.path)).toEqual(["public/session"]);
		expect(view).toMatchObject({ kind: "ready", fields: expect.arrayContaining(["consent", "agree"]) });
	});

	it("maps a refused submit to a message and keeps the ceremony open", async () => {
		const h = host({
			"public/session": ready,
			"public/submit": { ok: false, error: { code: "ENVELOPE_CLOSED", message: "closed" } },
		});
		const view = await handleSign(h.ctx, TOKEN, form(signForm));
		expect(view).toMatchObject({ kind: "ready", errorCode: "ENVELOPE_CLOSED" });
	});

	it("after signing, a ready PDF link from the session is offered", async () => {
		let calls = 0;
		const h = host({
			"public/session": () =>
				++calls === 1
					? ready
					: {
							ok: true,
							state: "closed",
							status: "completed",
							pdf: "ready",
							download: { url: "/d?e=1", expiresAt: "x" },
						},
			"public/submit": { ok: true, status: "completed" },
		});
		const view = await handleSign(h.ctx, TOKEN, form(signForm));
		expect(view).toMatchObject({ kind: "signed", download: "/d?e=1" });
	});

	it("decline posts the optional reason and only offers http(s) return URLs", async () => {
		const h = host({
			"public/session": ready,
			"public/decline": { ok: true, status: "declined", returnUrl: "javascript:alert(1)" },
		});
		const view = await handleSign(h.ctx, TOKEN, form({ intent: "decline", reason: " not for me " }));
		expect(h.seen[1]?.body).toEqual({ token: TOKEN, reason: "not for me" });
		expect(view).toEqual({ kind: "declined" });
	});

	const RECEIPT = `eyJ2IjoxfQ.${"S".repeat(43)}`;
	const RETURN = "https://events.example/booking/BK7Q2M?step=waiver";

	it("ES-FR-14 a signed intent envelope returns to the site with the receipt in the fragment, never the query", async () => {
		const h = host({
			"public/session": ready,
			"public/submit": { ok: true, status: "completed", returnUrl: RETURN, receipt: RECEIPT },
		});
		const view = await handleSign(h.ctx, TOKEN, form(signForm));
		expect(view).toMatchObject({ kind: "signed", returnUrl: `${RETURN}#receipt=${RECEIPT}` });
		const target = new URL(ceremonyRedirect(view) as string);
		expect(target.hash).toBe(`#receipt=${RECEIPT}`);
		expect(target.search).toBe("?step=waiver");
		expect(target.search).not.toContain(RECEIPT);
	});

	it("ES-FR-14 a decline returns with its receipt; no receipt or a bad one leaves the plain link", async () => {
		const declined = host({
			"public/session": ready,
			"public/decline": { ok: true, status: "declined", returnUrl: RETURN, receipt: RECEIPT },
		});
		const view = await handleSign(declined.ctx, TOKEN, form({ intent: "decline" }));
		expect(view).toEqual({ kind: "declined", returnUrl: `${RETURN}#receipt=${RECEIPT}` });
		expect(ceremonyRedirect(view)).toBe(`${RETURN}#receipt=${RECEIPT}`);

		for (const receipt of [undefined, "not a token", `${RECEIPT}&x=1`]) {
			const h = host({
				"public/session": ready,
				"public/decline": { ok: true, status: "declined", returnUrl: RETURN, receipt },
			});
			const plain = await handleSign(h.ctx, TOKEN, form({ intent: "decline" }));
			expect(plain, String(receipt)).toEqual({ kind: "declined", returnUrl: RETURN });
			expect(ceremonyRedirect(plain)).toBeUndefined();
		}
		// A return URL with a fragment of its own is never extended.
		const odd = host({
			"public/session": ready,
			"public/decline": { ok: true, status: "declined", returnUrl: `${RETURN}#x`, receipt: RECEIPT },
		});
		expect(await handleSign(odd.ctx, TOKEN, form({ intent: "decline" }))).toEqual({
			kind: "declined",
			returnUrl: `${RETURN}#x`,
		});
	});

	it("ES-FR-14 a closed intent envelope links back with its receipt but does not redirect a plain visit", async () => {
		const h = host({
			"public/session": { ok: true, state: "closed", status: "completed", returnUrl: RETURN, receipt: RECEIPT },
		});
		const view = await handleSign(h.ctx, TOKEN, null);
		expect(view).toMatchObject({ kind: "closed", returnUrl: `${RETURN}#receipt=${RECEIPT}` });
		expect(ceremonyRedirect(view)).toBeUndefined();
		expect(ceremonyRedirect({ kind: "signed" })).toBeUndefined();
	});

	it("a closed envelope shows its state, with the signed PDF state for the signer", async () => {
		const h = host({
			"public/session": { ok: true, state: "closed", status: "completed", title: "NDA", pdf: "pending" },
		});
		expect(await handleSign(h.ctx, TOKEN, null)).toMatchObject({
			kind: "closed",
			status: "completed",
			pdf: "pending",
		});
	});
});

describe("handleSignedCopy: the stable 'get my signed copy' page (ES-US-6)", () => {
	const done = {
		ok: true,
		state: "closed",
		status: "completed",
		title: "NDA",
		pdf: "ready",
		download: { url: "/d?e=fresh", expiresAt: "x" },
	};

	it("ES-US-6 posts the emailed token to public/session and offers the fresh download link", async () => {
		const h = host({ "public/session": done });
		const view = await handleSignedCopy({ ...h.ctx, pluginId: "r_abc" }, TOKEN);
		expect(view).toEqual({ kind: "closed", status: "completed", title: "NDA", pdf: "ready", download: "/d?e=fresh" });
		expect(h.seen).toHaveLength(1);
		expect(h.seen[0]?.body).toEqual({ token: TOKEN });
		expect(h.seen[0]?.url).toContain("/plugins/r_abc/public/session");
		expect(h.seen[0]?.url).not.toContain(TOKEN);
	});

	it("ES-US-6 a PDF still being built is pending, an unsigned envelope is not offered a copy", async () => {
		const pending = host({ "public/session": { ...done, pdf: "pending", download: undefined } });
		expect(await handleSignedCopy(pending.ctx, TOKEN)).toMatchObject({ kind: "closed", pdf: "pending" });
		const unsigned = host({ "public/session": ready });
		expect(await handleSignedCopy(unsigned.ctx, TOKEN)).toEqual({ kind: "unsigned" });
	});

	it("ES-US-6 an invalid token is a defined error and the token is never logged", async () => {
		const h = host({ "public/session": { ok: false, error: { code: "SIGNING_TOKEN_INVALID", message: "x" } } });
		const log = vi.spyOn(console, "log");
		const err = vi.spyOn(console, "error");
		const view = await handleSignedCopy(h.ctx, TOKEN);
		expect(view).toMatchObject({ kind: "error", code: "SIGNING_TOKEN_INVALID" });
		for (const spy of [log, err]) expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
	});
});
