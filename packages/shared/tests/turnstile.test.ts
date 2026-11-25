import { describe, expect, it } from "vitest";
import { TURNSTILE_VERIFY_URL, verifyTurnstile } from "../src/turnstile";

function fakeFetch(body: unknown, status = 200) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fetch = async (url: string, init?: RequestInit) => {
		calls.push({ url, init });
		return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
	};
	return { fetch, calls };
}

const bad = { ok: false, error: "TURNSTILE_FAILED" };

describe("verifyTurnstile (EV-NFR-04)", () => {
	it("passes on success with exactly one call to the allowed host", async () => {
		const { fetch, calls } = fakeFetch({ success: true });
		expect(await verifyTurnstile(fetch, { secret: "sec", token: "tok", remoteIp: "1.2.3.4" })).toEqual({
			ok: true,
			value: true,
		});
		expect(calls).toHaveLength(1);
		const first = calls[0];
		expect(new URL(first?.url ?? "").hostname).toBe("challenges.cloudflare.com");
		expect(first?.url).toBe(TURNSTILE_VERIFY_URL);
		const body = String(first?.init?.body);
		expect(body).toContain("secret=sec");
		expect(body).toContain("response=tok");
		expect(body).toContain("remoteip=1.2.3.4");
	});

	it("omits remoteip when absent", async () => {
		const { fetch, calls } = fakeFetch({ success: true });
		await verifyTurnstile(fetch, { secret: "s", token: "t" });
		expect(String(calls[0]?.init?.body)).not.toContain("remoteip");
	});

	it("fails with TURNSTILE_FAILED on failure, bad status, bad body, network error", async () => {
		const input = { secret: "s", token: "t" };
		expect(await verifyTurnstile(fakeFetch({ success: false }).fetch, input)).toEqual(bad);
		expect(await verifyTurnstile(fakeFetch({ success: true }, 500).fetch, input)).toEqual(bad);
		expect(await verifyTurnstile(fakeFetch("nope").fetch, input)).toEqual(bad);
		const boom = async (): Promise<Response> => {
			throw new Error("x");
		};
		expect(await verifyTurnstile(boom, input)).toEqual(bad);
	});

	it("fails without calling out when the token is missing", async () => {
		const { fetch, calls } = fakeFetch({ success: true });
		expect(await verifyTurnstile(fetch, { secret: "s", token: "" })).toEqual(bad);
		expect(calls).toHaveLength(0);
	});
});

describe("T185 (#79) Turnstile problems that refuse every visitor reach the site's log", () => {
	const lines = () => {
		const out: Array<[string, string, unknown]> = [];
		return {
			out,
			log: {
				warn: (m: string, d?: unknown) => void out.push(["warn", m, d]),
				error: (m: string, d?: unknown) => void out.push(["error", m, d]),
			},
		};
	};

	it("Cloudflare failing (5xx or unreachable) is turnstile.unavailable", async () => {
		const down = lines();
		const { fetch } = fakeFetch("oops", 503);
		expect(await verifyTurnstile(fetch, { secret: "s", token: "t", log: down.log })).toEqual(bad);
		expect(down.out).toEqual([["error", "turnstile.unavailable", { code: "turnstile.unavailable", status: 503 }]]);
		const gone = lines();
		const throwing = async () => {
			throw new TypeError("network");
		};
		expect(await verifyTurnstile(throwing, { secret: "s", token: "t", log: gone.log })).toEqual(bad);
		expect(gone.out[0]?.[1]).toBe("turnstile.unavailable");
	});

	it("a secret Cloudflare rejects is turnstile.secret_rejected; a visitor's bad token says nothing", async () => {
		const wrong = lines();
		const { fetch } = fakeFetch({ success: false, "error-codes": ["invalid-input-secret"] });
		expect(await verifyTurnstile(fetch, { secret: "s", token: "t", log: wrong.log })).toEqual(bad);
		expect(wrong.out).toEqual([
			["error", "turnstile.secret_rejected", { code: "turnstile.secret_rejected", reason: "invalid-input-secret" }],
		]);
		const visitor = lines();
		const stale = fakeFetch({ success: false, "error-codes": ["timeout-or-duplicate"] });
		expect(await verifyTurnstile(stale.fetch, { secret: "s", token: "t", log: visitor.log })).toEqual(bad);
		expect(visitor.out).toEqual([]);
	});
});
