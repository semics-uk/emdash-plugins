import { describe, expect, it } from "vitest";

import { handleCheckoutForm } from "../../src/astro/lib/checkout-form";

const TOKEN = "T".repeat(43);
const KEY = "k".repeat(40);
const url = new URL("https://site.example/events/spring");

interface Seen {
	url: string;
	method: string;
	body: unknown;
}

/** A fake in-process handler that records every request URL, like a request log. */
function host(reserve: unknown, cont: unknown) {
	const seen: Seen[] = [];
	const handler = async (_id: string, method: string, path: string, request: Request) => {
		seen.push({
			url: request.url,
			method,
			body: method === "POST" ? await request.clone().json() : undefined,
		});
		return path === "public/checkout/reserve" ? reserve : cont;
	};
	return { seen, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never };
}

function form(entries: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(entries)) data.set(k, v);
	return data;
}

const goodForm = {
	eventId: "ev1",
	"qty:general": "2",
	"qty:vip": "0",
	name: " Ada ",
	email: "ada@example.com",
	idempotencyKey: KEY,
	"cf-turnstile-response": "ts",
};

const reserved = { success: true, data: { ok: true, bookingRef: "ABCDEFGHJK", accessToken: TOKEN } };
const done = { success: true, data: { ok: true, status: "confirmed", next: { type: "done" } } };

describe("handleCheckoutForm (EU-FR-05, EU-FR-06)", () => {
	it("EU-FR-05 reserves, continues and redirects to the booking page with the ref only", async () => {
		const h = host(reserved, done);
		const out = await handleCheckoutForm({ locals: h.locals, url }, form(goodForm), {});

		expect(out.location).toBe("/booking?ref=ABCDEFGHJK");
		expect(out.cookie).toEqual({ name: "semics_booking_ABCDEFGHJK", value: TOKEN });
		expect(h.seen.map((s) => s.method)).toEqual(["POST", "POST"]);
		expect(h.seen[0]?.body).toEqual({
			eventId: "ev1",
			lines: [{ ticketTypeId: "general", qty: 2 }],
			buyer: { name: "Ada", email: "ada@example.com" },
			idempotencyKey: KEY,
			turnstileToken: "ts",
		});
		expect(h.seen[1]?.body).toEqual({ bookingRef: "ABCDEFGHJK", accessToken: TOKEN });
	});

	it("EU-FR-06 the access token never appears in a plugin route URL or the redirect", async () => {
		const h = host(reserved, done);
		const out = await handleCheckoutForm({ locals: h.locals, url }, form(goodForm), {});
		expect(h.seen.length).toBeGreaterThan(0);
		for (const s of h.seen) expect(s.url).not.toContain(TOKEN);
		expect(out.location).not.toContain(TOKEN);
	});

	it("uses the configured plugin id, never the slug, for registry installs", async () => {
		const ids: string[] = [];
		const locals = {
			emdash: {
				handlePublicPluginApiRoute: async (id: string) => {
					ids.push(id);
					return { success: false, error: { code: "NOT_FOUND", message: "x" } };
				},
			},
		} as never;
		await handleCheckoutForm({ locals, url }, form(goodForm), { pluginId: "r_abc123" });
		expect(ids).toEqual(["r_abc123"]);
	});

	it("follows a paid booking's next step to the payment url", async () => {
		const h = host(reserved, { success: true, data: { next: { type: "pay", url: "https://pay.example/s/1" } } });
		const out = await handleCheckoutForm({ locals: h.locals, url }, form(goodForm), {});
		expect(out.location).toBe("https://pay.example/s/1");
		expect(out.cookie?.value).toBe(TOKEN);
	});

	it("redirects a refused reserve to the booking page with an error code and no cookie", async () => {
		const h = host({ success: false, error: { code: "SOLD_OUT", message: "Sold out" } }, undefined);
		const out = await handleCheckoutForm({ locals: h.locals, url }, form(goodForm), {});
		expect(out).toEqual({ location: "/booking?error=SOLD_OUT" });
		expect(h.seen).toHaveLength(1);
	});

	it("keeps a booking that failed to continue reachable by its ref", async () => {
		const h = host(reserved, { success: false, error: { code: "PAYMENT_FAILED", message: "no" } });
		const out = await handleCheckoutForm({ locals: h.locals, url }, form(goodForm), {});
		expect(out.location).toBe("/booking?ref=ABCDEFGHJK&error=PAYMENT_FAILED");
		expect(out.cookie?.value).toBe(TOKEN);
	});

	it("generates an idempotency key when the form has none, and rejects an empty order", async () => {
		const h = host(reserved, done);
		await handleCheckoutForm({ locals: h.locals, url }, form({ ...goodForm, idempotencyKey: "" }), {
			newKey: () => "g".repeat(43),
		});
		expect((h.seen[0]?.body as { idempotencyKey: string }).idempotencyKey).toBe("g".repeat(43));

		const empty = host(undefined, undefined);
		const out = await handleCheckoutForm({ locals: empty.locals, url }, form({ ...goodForm, "qty:general": "0" }), {});
		expect(out).toEqual({ location: "/booking?error=BAD_REQUEST" });
		expect(empty.seen).toHaveLength(0);
	});
});
