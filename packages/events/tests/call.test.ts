import { describe, expect, it, vi } from "vitest";

import { callPublicRoute, EVENTS_PLUGIN_ID } from "../src/astro/lib/call";

const url = new URL("https://site.example/events?x=1");

type Handler = (pluginId: string, method: string, path: string, request: Request) => Promise<unknown>;

function firstCall<T>(calls: T[]): T {
	const call = calls[0];
	if (call === undefined) throw new Error("expected at least one call");
	return call;
}

function localsWith(handler: Handler) {
	return { emdash: { handlePublicPluginApiRoute: handler } } as never;
}

describe("callPublicRoute (EU-FR-02, Spike S2)", () => {
	it("passes method, path and JSON body through unchanged to the in-process handler", async () => {
		const handler = vi.fn<Handler>(async () => ({ success: true, data: { ok: 1 } }));
		const fetchFn = vi.fn<typeof fetch>();

		const result = await callPublicRoute(
			{ locals: localsWith(handler), url, fetch: fetchFn },
			{ method: "POST", path: "public/probe", body: { a: 1, nested: { b: [2, 3] } } },
		);

		expect(result).toEqual({ ok: true, data: { ok: 1 }, via: "in-process" });
		expect(fetchFn).not.toHaveBeenCalled();
		expect(handler).toHaveBeenCalledTimes(1);
		const [pluginId, method, path, request] = firstCall(handler.mock.calls);
		expect(pluginId).toBe(EVENTS_PLUGIN_ID);
		expect(method).toBe("POST");
		expect(path).toBe("public/probe");
		expect(request.method).toBe("POST");
		expect(request.url).toBe("https://site.example/_emdash/api/plugins/semics-events/public/probe");
		expect(request.headers.get("content-type")).toBe("application/json");
		expect(await request.json()).toEqual({ a: 1, nested: { b: [2, 3] } });
	});

	it("sends a GET body as query parameters, the shape public GET routes read", async () => {
		const handler = vi.fn<Handler>(async () => ({ success: true, data: [] }));

		await callPublicRoute(
			{ locals: localsWith(handler), url },
			{ method: "GET", path: "public/probe", body: { slug: "spring-fair", tag: ["a", "b"] } },
		);

		const [, method, path, request] = firstCall(handler.mock.calls);
		expect(method).toBe("GET");
		expect(path).toBe("public/probe");
		const sent = new URL(request.url);
		expect(sent.pathname).toBe("/_emdash/api/plugins/semics-events/public/probe");
		expect(sent.searchParams.get("slug")).toBe("spring-fair");
		expect(sent.searchParams.getAll("tag")).toEqual(["a", "b"]);
	});

	it("defaults to GET and returns the handler's error as a defined error result", async () => {
		const handler = vi.fn<Handler>(async () => ({
			success: false,
			error: { code: "NOT_FOUND", message: "Plugin route not found" },
		}));

		const result = await callPublicRoute({ locals: localsWith(handler), url }, { path: "public/probe" });

		expect(firstCall(handler.mock.calls)[1]).toBe("GET");
		expect(result).toEqual({
			ok: false,
			error: { code: "NOT_FOUND", message: "Plugin route not found" },
			via: "in-process",
		});
	});

	it("turns a thrown handler error into an error result instead of crashing the page", async () => {
		const handler = vi.fn<Handler>(async () => {
			throw new Error("sandbox exploded");
		});

		const result = await callPublicRoute({ locals: localsWith(handler), url }, { path: "public/probe" });

		expect(result).toEqual({
			ok: false,
			error: { code: "ROUTE_CALL_FAILED", message: "sandbox exploded" },
			via: "in-process",
		});
	});

	it("falls back to fetch(Astro.url.origin + route) when no in-process handler is available", async () => {
		const fetchFn = vi.fn<typeof fetch>(async () => Response.json({ success: true, data: { echoed: true } }));

		const result = await callPublicRoute(
			{ locals: {}, url, fetch: fetchFn },
			{ method: "POST", path: "/public/probe", body: { a: 1 } },
		);

		expect(result).toEqual({ ok: true, data: { echoed: true }, via: "fetch" });
		const [input, init] = firstCall(fetchFn.mock.calls);
		const request = new Request(input, init);
		expect(request.url).toBe("https://site.example/_emdash/api/plugins/semics-events/public/probe");
		expect(request.method).toBe("POST");
		expect(await request.json()).toEqual({ a: 1 });
	});

	it("maps a failed fetch fallback response to an error result", async () => {
		const fetchFn = vi.fn<typeof fetch>(async () =>
			Response.json(
				{ success: false, error: { code: "NOT_FOUND", message: "Plugin route not found" } },
				{ status: 404 },
			),
		);

		const result = await callPublicRoute({ locals: undefined, url, fetch: fetchFn }, { path: "public/probe" });

		expect(result).toEqual({
			ok: false,
			error: { code: "NOT_FOUND", message: "Plugin route not found" },
			via: "fetch",
		});
	});
	it("refuses to put token-like fields in a GET query string (R10)", async () => {
		const handler = vi.fn<Handler>(async () => ({ success: true, data: {} }));
		for (const key of ["token", "accessToken", "receipt", "secret", "t"]) {
			const result = await callPublicRoute(
				{ locals: localsWith(handler), url },
				{ path: "public/booking", body: { [key]: "abc" } },
			);
			expect(result).toEqual({
				ok: false,
				error: { code: "TOKEN_IN_QUERY", message: expect.stringContaining(key) },
				via: "in-process",
			});
		}
		expect(handler).not.toHaveBeenCalled();
	});
});
