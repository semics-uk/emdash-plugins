/**
 * The waitlist in the Free UI (EV-FR-16, EV-US-6, T081): the widget's "Join the waitlist" form posts to
 * `/_events/waitlist` (no JavaScript needed), which refuses cross-site posts, asks the core's
 * `public/waitlist/join` and goes back to the widget with an outcome code only (never what was typed).
 * The emailed offer link opens `/booking?ref=&k=&offer=1`; only the page's POST claims it
 * (`public/waitlist/claim`), keeps the fresh token in the booking cookie and continues the booking.
 */
import { describe, expect, it } from "vitest";

import { claimOfferLink } from "../../src/astro/lib/checkout-form";
import { handleWaitlistRequest, readWaitlistState, WAITLIST_PATH } from "../../src/astro/lib/waitlist";
import { anchorId } from "../../src/astro/lib/widget";

const url = new URL(`https://site.example${WAITLIST_PATH}`);
const REF = "ABCDEFGHJK";
const CODE = "c".repeat(43);
const TOKEN = "T".repeat(43);

function host(answers: Record<string, unknown>) {
	const seen: Array<{ path: string; body: unknown }> = [];
	const handler = async (_id: string, method: string, path: string, request: Request) => {
		seen.push({ path, body: method === "POST" ? await request.clone().json() : undefined });
		return answers[path] ?? { success: false, error: { code: "NOT_FOUND", message: "no route" } };
	};
	return { seen, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never };
}

function post(entries: Record<string, string>, headers: Record<string, string> = { "sec-fetch-site": "same-origin" }) {
	const body = new URLSearchParams(entries);
	return new Request(url, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded", ...headers } });
}

const redirect = (location: string, status = 302) => new Response(null, { status, headers: { location } });
const cookies = { set: () => undefined };
const joined = { success: true, data: { ok: true } };
const refused = (code: string) => ({ success: true, data: { ok: false, error: { code, message: "no" } } });

const fields = {
	eventId: "ev1",
	returnTo: "/events/gig",
	name: "Ada Lovelace",
	email: "ada@example.com",
	qty: "2",
	"cf-turnstile-response": "tok",
};

describe("/_events/waitlist (EV-US-6)", () => {
	it("EV-US-6 joins through public/waitlist/join and goes back to the widget with the outcome only", async () => {
		const h = host({ "public/waitlist/join": joined });
		const res = await handleWaitlistRequest({ request: post(fields), url, locals: h.locals, redirect, cookies }, {});
		expect(res.status).toBe(303);
		expect(h.seen).toEqual([
			{
				path: "public/waitlist/join",
				body: { eventId: "ev1", name: "Ada Lovelace", email: "ada@example.com", qty: 2, turnstileToken: "tok" },
			},
		]);
		const location = res.headers.get("location") ?? "";
		expect(location).toBe(`/events/gig?waitlist=joined&booking_event=ev1#${anchorId("ev1")}`);
		expect(location).not.toContain("ada");
		expect(readWaitlistState(new URL(location, url), "ev1")).toBe("joined");
		expect(readWaitlistState(new URL(location, url), "ev2")).toBeUndefined();
	});

	it("EV-US-6 sends a date and ticket type only when chosen", async () => {
		const h = host({ "public/waitlist/join": joined });
		const form = { ...fields, occurrenceId: "oc1", ticketTypeId: "tt1", "cf-turnstile-response": "" };
		await handleWaitlistRequest({ request: post(form), url, locals: h.locals, redirect, cookies }, {});
		expect(h.seen[0]?.body).toEqual({
			eventId: "ev1",
			occurrenceId: "oc1",
			ticketTypeId: "tt1",
			name: "Ada Lovelace",
			email: "ada@example.com",
			qty: 2,
		});
	});

	it("EV-US-6 a refusal goes back as its code; an unknown code reads as a general failure", async () => {
		const h = host({ "public/waitlist/join": refused("RATE_LIMITED") });
		const res = await handleWaitlistRequest({ request: post(fields), url, locals: h.locals, redirect, cookies }, {});
		const back = new URL(res.headers.get("location") ?? "", url);
		expect(readWaitlistState(back, "ev1")).toBe("RATE_LIMITED");
		back.searchParams.set("waitlist", "<script>");
		expect(readWaitlistState(back, "ev1")).toBe("INTERNAL");
	});

	it("T057 refuses a cross-site post before anything runs", async () => {
		const h = host({ "public/waitlist/join": joined });
		const request = post(fields, { "sec-fetch-site": "cross-site" });
		const res = await handleWaitlistRequest({ request, url, locals: h.locals, redirect, cookies }, {});
		expect(res.status).toBe(403);
		expect(h.seen).toEqual([]);
	});

	it("never sends the visitor off the site", async () => {
		const h = host({ "public/waitlist/join": joined });
		const request = post({ ...fields, returnTo: "https://evil.example/x" });
		const res = await handleWaitlistRequest({ request, url, locals: h.locals, redirect, cookies }, {});
		expect(res.headers.get("location")?.startsWith("/?")).toBe(true);
	});
});

describe("claiming an offer (EV-FR-16, R34)", () => {
	it("EV-FR-16 claims with the code, keeps the token in the cookie, and continues the booking", async () => {
		const h = host({
			"public/waitlist/claim": { success: true, data: { ok: true, bookingRef: REF, accessToken: TOKEN } },
			"public/checkout/continue": { success: true, data: { ok: true, status: "confirmed", next: { type: "done" } } },
		});
		const out = await claimOfferLink({ locals: h.locals, url }, { ref: REF, code: CODE }, {});
		expect(h.seen).toEqual([
			{ path: "public/waitlist/claim", body: { bookingRef: REF, code: CODE } },
			{ path: "public/checkout/continue", body: { bookingRef: REF, accessToken: TOKEN } },
		]);
		expect(out).toEqual({ location: `/booking?ref=${REF}`, cookie: { name: `semics_booking_${REF}`, value: TOKEN } });
	});

	it("EV-FR-16 a lapsed or used offer says so and sets no cookie", async () => {
		const h = host({ "public/waitlist/claim": refused("NOT_FOUND") });
		const out = await claimOfferLink({ locals: h.locals, url }, { ref: REF, code: CODE }, {});
		expect(out).toEqual({ location: `/booking?ref=${REF}&error=OFFER_INVALID` });
		const bad = await claimOfferLink({ locals: h.locals, url }, { ref: "nope", code: CODE }, {});
		expect(bad.cookie).toBeUndefined();
		expect(h.seen).toHaveLength(1);
	});
});
