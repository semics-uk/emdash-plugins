import { describe, expect, it } from "vitest";

import { callPublicRoute, ESIGN_PLUGIN_ID } from "../../src/astro/lib/call";
import { handleSign } from "../../src/astro/lib/sign";

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
	consent: { version: "1", wording: "I agree to sign electronically." },
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
