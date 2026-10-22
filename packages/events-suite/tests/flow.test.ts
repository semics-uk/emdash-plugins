import { describe, expect, it } from "vitest";

import { seatField, WAIVER_PATH } from "../src/astro/lib/form";
import { FLOW_STEPS, flowCookieName, handleWaiverRequest, type WaiverOutcome } from "../src/astro/lib/flow";

// <BookingWithWaiver> end to end against a faked host (SX-FR-02, SX-FR-03): book → sign inline →
// receipt → confirmed, through the real UI helpers of both products (`callPublicRoute`,
// `handleSign`, `forwardReceipt`). The Events core is faked: in Free, continue answers `done`; the
// "Pro" answers below stand in for the Pro signature step (`next: { type: "sign", intents }`), which
// the public repo cannot load. Plugin ids are registry-style on purpose: nothing may assume a slug.

const EVENTS = "r_events1";
const ESIGN = "r_esign1";
const IDS = { eventsPluginId: EVENTS, esignPluginId: ESIGN };
const REF = "ABCDEFGHJK";
const ACCESS = "A".repeat(43);
const ORIGIN = "https://site.example";
const RECEIPT = (n: number) => `${String(n).repeat(120)}.${"s".repeat(43)}`;
const SIGNING = (n: number) => `${String(n).repeat(43)}`;
const INTENT = (n: number) => `${"i".repeat(200)}${n}.${"m".repeat(43)}`;

type Answer = unknown;
type Responder = (body: Record<string, unknown>, n: number) => Answer;

const ok = (data: Record<string, unknown>) => ({ success: true, data: { ok: true, ...data } });
const refused = (code: string, issues?: unknown[]) => ({
	success: true,
	data: { ok: false, error: { code, message: code, ...(issues ? { issues } : {}) } },
});

/** A host whose in-process handler answers `<pluginId> <path>` from `routes`, recording every call. */
function host(routes: Record<string, Responder>) {
	const calls: Array<{ id: string; path: string; body: Record<string, unknown> }> = [];
	const counts = new Map<string, number>();
	const handler = async (id: string, _method: string, path: string, request: Request) => {
		const body = (await request.clone().json().catch(() => ({}))) as Record<string, unknown>;
		calls.push({ id, path, body });
		const key = `${id} ${path}`;
		const n = (counts.get(key) ?? 0) + 1;
		counts.set(key, n);
		const respond = routes[key];
		return respond ? respond(body, n) : refused("NOT_FOUND");
	};
	return { calls, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never };
}

function post(path: string, fields: Record<string, string>, headers: Record<string, string> = {}): Request {
	const body = new URLSearchParams(fields);
	return new Request(`${ORIGIN}${path}`, {
		method: "POST",
		body,
		headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin", ...headers },
	});
}

function run(h: ReturnType<typeof host>, request: Request, cookies: Record<string, string> = {}) {
	return handleWaiverRequest(
		{ locals: h.locals, url: new URL(request.url), request, cookie: (name) => cookies[name] },
		IDS,
		{ newKey: () => "n".repeat(43) },
	);
}

const ORDER = {
	intent: "book",
	eventId: "ev_1",
	returnTo: "/events/climb",
	idempotencyKey: "k".repeat(43),
	name: "Ada Lovelace",
	email: "ada@example.com",
	[seatField(1, "ticketTypeId")]: "tt_adult",
	[seatField(1, "name")]: "Ada Lovelace",
	[seatField(2, "ticketTypeId")]: "tt_child",
	[seatField(2, "name")]: "Byron Lovelace",
	[seatField(2, "minor")]: "on",
	[seatField(3, "ticketTypeId")]: "tt_adult",
	[seatField(3, "name")]: "Grace Hopper",
	[seatField(3, "email")]: "grace@example.com",
};

const reserve = () => ok({ bookingRef: REF, accessToken: ACCESS, status: "held" });

/** The Pro answer: the buyer signs for self and the minor inline, the other adult by email. */
const signNext = () =>
	ok({
		bookingRef: REF,
		status: "awaiting_signature",
		next: {
			type: "sign",
			intents: [
				{ ref: `${REF}:1`, delivery: "inline", as: "self", token: INTENT(1) },
				{ ref: `${REF}:2`, delivery: "inline", as: "guardian", token: INTENT(2) },
				{ ref: `${REF}:3`, delivery: "email", as: "self", token: INTENT(3) },
			],
		},
	});

function fromIntent(emailStatus = "draft"): Responder {
	return (body) => {
		const n = Number(String(body.intent).split(".")[0]?.slice(-1));
		return n === 3 ? ok({ envelopeId: "env_3", status: emailStatus }) : ok({ envelopeId: `env_${n}`, status: "sent", signingToken: SIGNING(n) });
	};
}

const expectRedirect = (outcome: WaiverOutcome) => {
	expect(outcome.type).toBe("redirect");
	return outcome as Extract<WaiverOutcome, { type: "redirect" }>;
};

const cookieValue = (outcome: Extract<WaiverOutcome, { type: "redirect" }>, name: string) =>
	outcome.cookies.find((c) => c.name === name);

describe("booking (SX-FR-02)", () => {
	it("SX-FR-02 Free: no signature step, so the waiver flow is a plain booking that lands confirmed", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: () =>
				ok({ bookingRef: REF, status: "confirmed", next: { type: "done", bookingRef: REF } }),
		});
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, ORDER)));
		expect(outcome.location).toBe(`/booking?ref=${REF}`);
		expect(cookieValue(outcome, `semics_booking_${REF}`)).toMatchObject({ value: ACCESS, options: { path: "/booking", httpOnly: true } });
		expect(h.calls.map((c) => `${c.id} ${c.path}`)).toEqual([
			`${EVENTS} public/checkout/reserve`,
			`${EVENTS} public/checkout/continue`,
		]);
		expect(h.calls[0]?.body).toMatchObject({
			eventId: "ev_1",
			buyer: { name: "Ada Lovelace", email: "ada@example.com" },
			lines: [
				{ ticketTypeId: "tt_adult", qty: 2 },
				{ ticketTypeId: "tt_child", qty: 1 },
			],
			idempotencyKey: "k".repeat(43),
		});
		// The "under 18" control reaches the core as `minor: true` on that attendee only.
		expect(h.calls[1]?.body).toEqual({
			bookingRef: REF,
			accessToken: ACCESS,
			attendees: [
				{ ticketTypeId: "tt_adult", name: "Ada Lovelace" },
				{ ticketTypeId: "tt_child", name: "Byron Lovelace", minor: true },
				{ ticketTypeId: "tt_adult", name: "Grace Hopper", email: "grace@example.com" },
			],
		});
	});

	it("SX-FR-02 a name with a control character is refused before any call, back on the widget", async () => {
		const h = host({});
		const outcome = expectRedirect(
			await run(h, post(WAIVER_PATH, { ...ORDER, [seatField(2, "name")]: "Byron\u0007Lovelace" })),
		);
		expect(h.calls).toEqual([]);
		const url = new URL(outcome.location, ORIGIN);
		expect(url.pathname).toBe("/events/climb");
		expect(url.searchParams.get("waiver_error")).toBe("CONTROL_CHARACTERS");
		expect(url.searchParams.get("waiver_fields")).toBe("attendee.2.name");
		expect(outcome.location).not.toContain("Byron");
	});

	it("SX-FR-02 reserve refusals go back to the widget with the fields to fix", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: () => refused("BAD_REQUEST", [{ path: "buyer.email", code: "invalid" }]),
		});
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, ORDER)));
		const url = new URL(outcome.location, ORIGIN);
		expect(url.searchParams.get("waiver_error")).toBe("BAD_REQUEST");
		expect(url.searchParams.get("waiver_fields")).toBe("email");
		expect(outcome.cookies).toEqual([]);
	});

	it("SX-FR-02 a refused continue releases the held seats and names the attendee rows to fix", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: () =>
				refused("BAD_REQUEST", [
					{ path: "attendees", code: "WAIVER_EMAIL_REQUIRED" },
					{ path: "attendees.2.name", code: "too_long" },
				]),
			[`${EVENTS} public/booking/cancel`]: () => ok({ status: "cancelled" }),
		});
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, ORDER)));
		expect(h.calls.at(-1)).toEqual({ id: EVENTS, path: "public/booking/cancel", body: { bookingRef: REF, accessToken: ACCESS } });
		const url = new URL(outcome.location, ORIGIN);
		expect(url.searchParams.get("waiver_error")).toBe("WAIVER_EMAIL_REQUIRED");
		expect(url.searchParams.get("waiver_fields")).toBe("attendees,attendee.3.name");
	});

	it("SX-FR-02 a cross-site post is refused before anything runs", async () => {
		const h = host({});
		expect(await run(h, post(WAIVER_PATH, ORDER, { "sec-fetch-site": "cross-site" }))).toEqual({ type: "forbidden" });
		expect(h.calls).toEqual([]);
	});

	it("SX-FR-02 payment slot (Phase 4): continue's pay step sends the browser to the provider", async () => {
		expect(FLOW_STEPS).toEqual(["book", "sign", "pay", "done"]);
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: () =>
				ok({ bookingRef: REF, status: "awaiting_payment", next: { type: "pay", url: "https://pay.example/s/1" } }),
		});
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, ORDER)));
		expect(outcome.location).toBe("https://pay.example/s/1");
		expect(cookieValue(outcome, `semics_booking_${REF}`)?.value).toBe(ACCESS);
	});
});

describe("signing intents (SX-FR-03)", () => {
	it("SX-FR-03 every intent is redeemed with e-sign; inline tokens go to a path-scoped HttpOnly cookie", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: signNext,
			[`${ESIGN} public/envelopes/from-intent`]: fromIntent(),
		});
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, ORDER)));
		expect(outcome.location).toBe(`${WAIVER_PATH}?ref=${REF}`);
		expect(h.calls.filter((c) => c.id === ESIGN).map((c) => c.body)).toEqual([
			{ intent: INTENT(1) },
			{ intent: INTENT(2) },
			{ intent: INTENT(3) },
		]);
		const flow = cookieValue(outcome, flowCookieName(REF));
		expect(flow?.value).toBe(`${SIGNING(1)}.${SIGNING(2)}`);
		expect(flow?.options).toMatchObject({ path: WAIVER_PATH, httpOnly: true, sameSite: "strict", secure: true });
		for (const secret of [ACCESS, SIGNING(1), INTENT(1)]) expect(outcome.location).not.toContain(secret);
	});

	it("SX-FR-03 an email intent answered `draft` is the invitation on its way, like `sent`", async () => {
		for (const status of ["draft", "sent"]) {
			const h = host({
				[`${EVENTS} public/checkout/reserve`]: reserve,
				[`${EVENTS} public/checkout/continue`]: signNext,
				[`${ESIGN} public/envelopes/from-intent`]: fromIntent(status),
			});
			const outcome = expectRedirect(await run(h, post(WAIVER_PATH, ORDER)));
			expect(outcome.location, status).toBe(`${WAIVER_PATH}?ref=${REF}`);
		}
	});

	it("SX-FR-03 an intent e-sign refuses stops the flow with a defined error, no tokens kept", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: signNext,
			[`${ESIGN} public/envelopes/from-intent`]: (_b, n) => (n === 2 ? refused("TEMPLATE_NOT_FOUND") : fromIntent()(_b, n)),
		});
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, ORDER)));
		expect(outcome.location).toBe(`${WAIVER_PATH}?ref=${REF}&error=SIGNING_UNAVAILABLE`);
		expect(cookieValue(outcome, flowCookieName(REF))).toBeUndefined();
	});

	it("SX-FR-03 only email signers: nothing to sign here, the booking page shows the pending waivers", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: () =>
				ok({
					bookingRef: REF,
					status: "awaiting_signature",
					next: { type: "sign", intents: [{ ref: `${REF}:3`, delivery: "email", as: "self", token: INTENT(3) }] },
				}),
			[`${ESIGN} public/envelopes/from-intent`]: fromIntent(),
		});
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, ORDER)));
		expect(outcome.location).toBe(`/booking?ref=${REF}`);
	});
});

const SESSION = (n: number) =>
	ok({
		state: "ready",
		envelope: { id: `env_${n}`, title: "Climbing waiver", status: "sent", docSha256: "d".repeat(64), expiresAt: null },
		signer: { name: "Ada Lovelace", ...(n === 2 ? { as: "guardian", participant: "Byron Lovelace" } : {}) },
		snapshot: "# Waiver\n\nI accept the risks.",
		consent: { version: "1", wording: "I agree to sign electronically.", sha256: "c".repeat(64) },
	});

const SIGN_FORM = { intent: "sign", typedName: "Ada Lovelace", consent: "on", agree: "on" };
const RETURN = `${ORIGIN}/booking?ref=${REF}`;

function ceremonyHost(extra: Record<string, Responder> = {}) {
	return host({
		[`${ESIGN} public/session`]: (body) => {
			const n = Number(String(body.token).slice(0, 1));
			return SESSION(n);
		},
		[`${ESIGN} public/submit`]: (body) => ok({ returnUrl: RETURN, receipt: RECEIPT(Number(String(body.token).slice(0, 1))) }),
		[`${ESIGN} public/decline`]: (body) => ok({ returnUrl: RETURN, receipt: RECEIPT(Number(String(body.token).slice(0, 1))) }),
		[`${EVENTS} signatures/receipt`]: (body) =>
			ok({
				bookingRef: REF,
				status: body.receipt === RECEIPT(2) ? "confirmed" : "awaiting_signature",
				signature: { status: String(body.receipt).startsWith("9") ? "declined" : "completed" },
			}),
		...extra,
	});
}

const get = (path: string) => new Request(`${ORIGIN}${path}`);

describe("inline ceremony and receipt (SX-FR-03)", () => {
	const cookies = { [flowCookieName(REF)]: `${SIGNING(1)}.${SIGNING(2)}` };

	it("SX-FR-03 GET renders the first signer's ceremony, posting back to this page", async () => {
		const h = ceremonyHost();
		const outcome = await run(h, get(`${WAIVER_PATH}?ref=${REF}`), cookies);
		expect(outcome).toMatchObject({ type: "render", ref: REF, token: SIGNING(1), remaining: 1, view: { kind: "ready" } });
		// A GET only looks: the envelope is opened by the first form post (T117).
		expect(h.calls).toEqual([{ id: ESIGN, path: "public/session", body: { token: SIGNING(1) } }]);
	});

	it("SX-FR-03 signing one of several: the receipt is forwarded in-process, then the next signer", async () => {
		const h = ceremonyHost();
		const outcome = expectRedirect(await run(h, post(`${WAIVER_PATH}?ref=${REF}`, SIGN_FORM), cookies));
		expect(h.calls.map((c) => `${c.id} ${c.path}`)).toEqual([
			`${ESIGN} public/session`,
			`${ESIGN} public/submit`,
			`${ESIGN} public/session`,
			`${EVENTS} signatures/receipt`,
		]);
		expect(h.calls[3]?.body).toEqual({ receipt: RECEIPT(1) });
		expect(outcome.location).toBe(`${WAIVER_PATH}?ref=${REF}`);
		expect(cookieValue(outcome, flowCookieName(REF))?.value).toBe(SIGNING(2));
		expect(outcome.location).not.toContain(RECEIPT(1));

		// The guardian's ceremony is next.
		const next = await run(ceremonyHost(), get(`${WAIVER_PATH}?ref=${REF}`), { [flowCookieName(REF)]: SIGNING(2) });
		expect(next).toMatchObject({ type: "render", token: SIGNING(2), remaining: 0 });
	});

	it("SX-FR-03 the last signature returns to the booking page, confirmed, and clears the cookie", async () => {
		const h = ceremonyHost();
		const outcome = expectRedirect(
			await run(h, post(`${WAIVER_PATH}?ref=${REF}`, SIGN_FORM), { [flowCookieName(REF)]: SIGNING(2) }),
		);
		expect(h.calls.at(-1)).toEqual({ id: EVENTS, path: "signatures/receipt", body: { receipt: RECEIPT(2) } });
		expect(outcome.location).toBe(`/booking?ref=${REF}&waiver=signed`);
		expect(cookieValue(outcome, flowCookieName(REF))).toMatchObject({ value: "", options: { maxAge: 0, path: WAIVER_PATH } });
	});

	it("SX-FR-03 a decline is recorded and ends the flow on the booking page", async () => {
		const h = ceremonyHost({
			[`${ESIGN} public/decline`]: () => ok({ returnUrl: RETURN, receipt: RECEIPT(9) }),
		});
		const outcome = expectRedirect(
			await run(h, post(`${WAIVER_PATH}?ref=${REF}`, { intent: "decline", reason: "No" }), cookies),
		);
		expect(h.calls.at(-1)).toEqual({ id: EVENTS, path: "signatures/receipt", body: { receipt: RECEIPT(9) } });
		expect(outcome.location).toBe(`/booking?ref=${REF}&waiver=declined`);
		expect(cookieValue(outcome, flowCookieName(REF))?.options).toMatchObject({ maxAge: 0 });
	});

	it("SX-FR-03 an incomplete form re-renders the ceremony with the fields to fix; nothing is submitted", async () => {
		const h = ceremonyHost();
		const outcome = await run(h, post(`${WAIVER_PATH}?ref=${REF}`, { intent: "sign", typedName: "Ada" }), cookies);
		expect(outcome).toMatchObject({ type: "render", view: { kind: "ready", fields: ["consent", "agree"] } });
		expect(h.calls.map((c) => c.path)).toEqual(["public/session"]);
	});

	it("SX-FR-03 an already closed envelope (signed in another tab) is forwarded and skipped", async () => {
		const h = ceremonyHost({
			[`${ESIGN} public/session`]: (body) =>
				String(body.token) === SIGNING(1)
					? ok({ state: "closed", status: "completed", returnUrl: RETURN, receipt: RECEIPT(1) })
					: SESSION(2),
		});
		const outcome = await run(h, get(`${WAIVER_PATH}?ref=${REF}`), cookies);
		expect(h.calls.map((c) => `${c.id} ${c.path}`)).toEqual([
			`${ESIGN} public/session`,
			`${EVENTS} signatures/receipt`,
			`${ESIGN} public/session`,
		]);
		expect(outcome).toMatchObject({ type: "render", token: SIGNING(2), remaining: 0 });
	});

	it("SX-FR-03 without the flow cookie, or with a malformed ref, there is nothing to sign here", async () => {
		const h = ceremonyHost();
		expect(expectRedirect(await run(h, get(`${WAIVER_PATH}?ref=${REF}`))).location).toBe(`/booking?ref=${REF}`);
		expect(expectRedirect(await run(h, get(`${WAIVER_PATH}?ref=nope`), cookies)).location).toBe("/booking");
		expect(
			expectRedirect(await run(h, get(`${WAIVER_PATH}?ref=${REF}`), { [flowCookieName(REF)]: "not a token!" })).location,
		).toBe(`/booking?ref=${REF}`);
		expect(h.calls).toEqual([]);
	});

	it("SX-FR-03 an e-sign error is shown, not swallowed; `?error=` renders a defined error", async () => {
		const h = ceremonyHost({ [`${ESIGN} public/session`]: () => refused("SIGNING_TOKEN_EXPIRED") });
		expect(await run(h, get(`${WAIVER_PATH}?ref=${REF}`), cookies)).toMatchObject({
			type: "render",
			view: { kind: "error", code: "SIGNING_TOKEN_EXPIRED" },
		});
		expect(await run(host({}), get(`${WAIVER_PATH}?ref=${REF}&error=SIGNING_UNAVAILABLE`))).toEqual({
			type: "error",
			ref: REF,
			code: "SIGNING_UNAVAILABLE",
		});
	});
});
