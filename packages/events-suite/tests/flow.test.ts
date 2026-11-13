import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	FLOW_STEPS,
	flowCookieName,
	handleWaiverRequest,
	leavesSite,
	retryCookieName,
	type WaiverOutcome,
} from "../src/astro/lib/flow";
import { checkWaiverSeats, seatField, WAIVER_MESSAGES, WAIVER_PATH } from "../src/astro/lib/form";

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
	// The cores' refusal shape: `{ ok: false, error, issues? }` (`badRequest` in Events' routes/reply.ts).
	data: { ok: false, error: { code, message: code }, ...(issues ? { issues } : {}) },
});

/** A host whose in-process handler answers `<pluginId> <path>` from `routes`, recording every call. */
function host(routes: Record<string, Responder>) {
	const calls: Array<{ id: string; path: string; body: Record<string, unknown> }> = [];
	const counts = new Map<string, number>();
	const handler = async (id: string, _method: string, path: string, request: Request) => {
		const body = (await request
			.clone()
			.json()
			.catch(() => ({}))) as Record<string, unknown>;
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
		return n === 3
			? ok({ envelopeId: "env_3", status: emailStatus })
			: ok({ envelopeId: `env_${n}`, status: "sent", signingToken: SIGNING(n) });
	};
}

const expectRedirect = (outcome: WaiverOutcome) => {
	expect(outcome.type).toBe("redirect");
	return outcome as Extract<WaiverOutcome, { type: "redirect" }>;
};

const cookieValue = (outcome: Extract<WaiverOutcome, { type: "redirect" }>, name: string) =>
	outcome.cookies.find((c) => c.name === name);

/** The cookies a browser would send to `path` (RFC 6265 path-match), from the ones a response set. */
function browserJar(
	set: ReadonlyArray<{ name: string; value: string; options: Record<string, unknown> }>,
	path: string,
) {
	const jar: Record<string, string> = {};
	for (const c of set) {
		const p = String(c.options.path ?? "/");
		const matches = path === p || (path.startsWith(p) && (p.endsWith("/") || path[p.length] === "/"));
		if (matches && Number(c.options.maxAge ?? 1) > 0) jar[c.name] = c.value;
	}
	return jar;
}

describe("booking (SX-FR-02)", () => {
	it("SX-FR-02 Free: no signature step, so the waiver flow is a plain booking that lands confirmed", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: () =>
				ok({ bookingRef: REF, status: "confirmed", next: { type: "done", bookingRef: REF } }),
		});
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, ORDER)));
		expect(outcome.location).toBe(`/booking?ref=${REF}`);
		expect(cookieValue(outcome, `semics_booking_${REF}`)).toMatchObject({
			value: ACCESS,
			options: { path: "/booking", httpOnly: true },
		});
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
		expect(h.calls.at(-1)).toEqual({
			id: EVENTS,
			path: "public/booking/cancel",
			body: { bookingRef: REF, accessToken: ACCESS },
		});
		const url = new URL(outcome.location, ORIGIN);
		expect(url.searchParams.get("waiver_error")).toBe("WAIVER_EMAIL_REQUIRED");
		expect(url.searchParams.get("waiver_fields")).toBe("attendees,attendee.3.name");
	});

	it("SX-FR-02 an order the waiver rules refuse never reserves: no booking left, no cancel, nothing typed in the URL", async () => {
		const h = host({});
		const { [seatField(2, "minor")]: _adult, ...order } = ORDER;
		const form = {
			...order,
			[seatField(2, "name")]: "Grace Hopper",
			[seatField(2, "email")]: "ADA@example.com",
			waiverEach: "1",
		};
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, form)));
		expect(h.calls).toEqual([]);
		const url = new URL(outcome.location, ORIGIN);
		expect(url.searchParams.get("waiver_error")).toBe("WAIVER_EMAIL_REQUIRED");
		expect(url.searchParams.get("waiver_fields")).toContain("attendee.2.email");
		expect(outcome.location).not.toContain("Grace");
		expect(outcome.location).not.toContain("example.com");
	});

	it("SX-FR-02 without the event's word on it (Free, or a waiver the buyer signs alone) the core decides", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: () =>
				ok({ bookingRef: REF, status: "confirmed", next: { type: "done" } }),
		});
		const form = { ...ORDER, [seatField(2, "email")]: "ada@example.com" };
		await run(h, post(WAIVER_PATH, form));
		expect(h.calls[0]?.path).toBe("public/checkout/reserve");
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
			[`${ESIGN} public/envelopes/from-intent`]: (_b, n) =>
				n === 2 ? refused("TEMPLATE_NOT_FOUND") : fromIntent()(_b, n),
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
		[`${ESIGN} public/submit`]: (body) =>
			ok({ returnUrl: RETURN, receipt: RECEIPT(Number(String(body.token).slice(0, 1))) }),
		[`${ESIGN} public/decline`]: (body) =>
			ok({ returnUrl: RETURN, receipt: RECEIPT(Number(String(body.token).slice(0, 1))) }),
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
		expect(outcome).toMatchObject({
			type: "render",
			ref: REF,
			token: SIGNING(1),
			remaining: 1,
			view: { kind: "ready" },
		});
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
		expect(cookieValue(outcome, flowCookieName(REF))).toMatchObject({
			value: "",
			options: { maxAge: 0, path: WAIVER_PATH },
		});
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
			expectRedirect(await run(h, get(`${WAIVER_PATH}?ref=${REF}`), { [flowCookieName(REF)]: "not a token!" }))
				.location,
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

describe("T153 the envelopes' deadline follows the hold", () => {
	const cookies = { [flowCookieName(REF)]: `${SIGNING(1)}.${SIGNING(2)}`, [retryCookieName(REF)]: ACCESS };
	const fresh = {
		[`${EVENTS} public/checkout/continue`]: signNext,
		[`${ESIGN} public/envelopes/from-intent`]: fromIntent(),
	};
	/** E-sign's rotated tokens: only seat 2 is left to sign. */
	const seatTwoLeft = () =>
		ok({
			bookingRef: REF,
			status: "awaiting_signature",
			next: {
				type: "sign",
				intents: [{ ref: `${REF}:2`, delivery: "inline", as: "guardian", token: INTENT(7) }],
			},
		});

	it("T153 a receipt that extends the hold re-issues the seats still to sign, so their deadlines move with it", async () => {
		const h = ceremonyHost({ ...fresh, [`${EVENTS} public/checkout/continue`]: seatTwoLeft });
		const outcome = expectRedirect(await run(h, post(`${WAIVER_PATH}?ref=${REF}`, SIGN_FORM), cookies));
		const paths = h.calls.map((c) => c.path);
		expect(paths.indexOf("signatures/receipt")).toBeLessThan(paths.indexOf("public/checkout/continue"));
		expect(paths.indexOf("public/checkout/continue")).toBeLessThan(paths.indexOf("public/envelopes/from-intent"));
		expect(h.calls.find((c) => c.path === "public/checkout/continue")?.body).toEqual({
			bookingRef: REF,
			accessToken: ACCESS,
		});
		expect(outcome.location).toBe(`${WAIVER_PATH}?ref=${REF}`);
		// The token e-sign answered with this time, not the cookie's old one.
		expect(cookieValue(outcome, flowCookieName(REF))?.value).toBe(SIGNING(7));
	});

	it("T153 when the re-issue is refused, the next signer goes on with the token already held", async () => {
		const h = ceremonyHost({ [`${EVENTS} public/checkout/continue`]: () => refused("LICENCE_REQUIRED") });
		const outcome = expectRedirect(await run(h, post(`${WAIVER_PATH}?ref=${REF}`, SIGN_FORM), cookies));
		expect(outcome.location).toBe(`${WAIVER_PATH}?ref=${REF}`);
		expect(cookieValue(outcome, flowCookieName(REF))?.value).toBe(SIGNING(2));
	});

	it("T153 a seat refused as expired while the booking is still open gets a fresh intent, not a dead end", async () => {
		const h = ceremonyHost({
			...fresh,
			[`${EVENTS} public/booking`]: () => ok({ status: "awaiting_signature" }),
			[`${ESIGN} public/session`]: () => refused("SIGNING_TOKEN_EXPIRED"),
		});
		const outcome = expectRedirect(await run(h, get(`${WAIVER_PATH}?ref=${REF}`), cookies));
		expect(h.calls.map((c) => c.path)).toContain("public/checkout/continue");
		expect(outcome.location).toBe(`${WAIVER_PATH}?ref=${REF}`);
		expect(cookieValue(outcome, flowCookieName(REF))?.value).toBe(`${SIGNING(1)}.${SIGNING(2)}`);
	});

	it("T153 without a booking answer an expired seat shows the error as before", async () => {
		const h = ceremonyHost({ ...fresh, [`${ESIGN} public/session`]: () => refused("SIGNING_TOKEN_EXPIRED") });
		expect(await run(h, get(`${WAIVER_PATH}?ref=${REF}`), cookies)).toMatchObject({
			type: "render",
			view: { kind: "error", code: "SIGNING_TOKEN_EXPIRED" },
		});
		expect(h.calls.map((c) => c.path)).not.toContain("public/checkout/continue");
	});
});

describe("an expired booking has nothing to sign (T151)", () => {
	const cookies = { [flowCookieName(REF)]: `${SIGNING(1)}.${SIGNING(2)}`, [retryCookieName(REF)]: ACCESS };
	const NOW = Date.parse("2026-11-02T10:00:00.000Z");
	const at = (ms: number) => new Date(NOW + ms).toISOString();
	const bookingAs = (data: Record<string, unknown>) => () =>
		ok({ bookingRef: REF, eventId: "ev_1", event: { title: "Clay session", slug: "clay" }, ...data });
	const runAt = (h: ReturnType<typeof host>, request: Request, jar: Record<string, string>) =>
		handleWaiverRequest({ locals: h.locals, url: new URL(request.url), request, cookie: (name) => jar[name] }, IDS, {
			now: () => NOW,
		});

	it("T151 an expired or cancelled booking shows the expired message and a link to the event, and no ceremony", async () => {
		for (const status of ["expired", "cancelled"]) {
			const h = ceremonyHost({ [`${EVENTS} public/booking`]: bookingAs({ status }) });
			const outcome = await runAt(h, get(`${WAIVER_PATH}?ref=${REF}`), cookies);
			expect(outcome).toEqual({ type: "error", ref: REF, code: "BOOKING_EXPIRED", href: "/events/clay" });
			expect(h.calls.map((c) => c.path)).toEqual(["public/booking"]);
		}
		expect(WAIVER_MESSAGES.BOOKING_EXPIRED).toBe("This booking has expired. Please book again.");
	});

	it("T151 a hold that lapsed before the sweeper ran is expired too; one still open signs as before", async () => {
		const lapsed = ceremonyHost({
			[`${EVENTS} public/booking`]: bookingAs({ status: "awaiting_signature", holdExpiresAt: at(-1000) }),
		});
		expect(await runAt(lapsed, get(`${WAIVER_PATH}?ref=${REF}`), cookies)).toMatchObject({
			type: "error",
			code: "BOOKING_EXPIRED",
		});
		const open = ceremonyHost({
			[`${EVENTS} public/booking`]: bookingAs({ status: "awaiting_signature", holdExpiresAt: at(60_000) }),
		});
		expect(await runAt(open, get(`${WAIVER_PATH}?ref=${REF}`), cookies)).toMatchObject({
			type: "render",
			token: SIGNING(1),
		});
	});

	it("T151 signing an expired booking is refused before e-sign is asked: nothing is submitted", async () => {
		const h = ceremonyHost({ [`${EVENTS} public/booking`]: bookingAs({ status: "expired" }) });
		const outcome = await runAt(h, post(`${WAIVER_PATH}?ref=${REF}`, SIGN_FORM), cookies);
		expect(outcome).toMatchObject({ type: "error", code: "BOOKING_EXPIRED" });
		expect(h.calls.some((c) => c.id === ESIGN)).toBe(false);
	});

	it("T151 without a slug the expired page has no event link; when Events cannot answer, signing goes on", async () => {
		const bare = ceremonyHost({ [`${EVENTS} public/booking`]: () => ok({ bookingRef: REF, status: "expired" }) });
		expect(await runAt(bare, get(`${WAIVER_PATH}?ref=${REF}`), cookies)).toEqual({
			type: "error",
			ref: REF,
			code: "BOOKING_EXPIRED",
		});
		const down = ceremonyHost();
		expect(await runAt(down, get(`${WAIVER_PATH}?ref=${REF}`), cookies)).toMatchObject({ type: "render" });
	});
});

describe("an ended booking's envelopes are voided from the waiver page (T152)", () => {
	const cookies = { [flowCookieName(REF)]: `${SIGNING(1)}.${SIGNING(2)}`, [retryCookieName(REF)]: ACCESS };
	const VOID = `void-intent.${"v".repeat(43)}`;

	it("T152 the expired page redeems the booking's void intents with e-sign, and still shows the expired message", async () => {
		const h = ceremonyHost({
			[`${EVENTS} public/booking`]: () =>
				ok({ bookingRef: REF, status: "expired", waiver: { refs: [], voids: { [`${REF}:1`]: VOID } } }),
			[`${ESIGN} public/envelopes/from-intent`]: () => ok({ status: "voided" }),
		});
		expect(await run(h, get(`${WAIVER_PATH}?ref=${REF}`), cookies)).toEqual({
			type: "error",
			ref: REF,
			code: "BOOKING_EXPIRED",
		});
		expect(h.calls.map((c) => [c.path, c.body])).toEqual([
			["public/booking", { bookingRef: REF, accessToken: ACCESS }],
			["public/envelopes/from-intent", { intent: VOID }],
		]);
		// No ceremony and no submit: the void is the only e-sign call.
		expect(h.calls.some((c) => c.path === "public/session" || c.path === "public/submit")).toBe(false);
	});

	it("T152 an e-sign that refuses the void never changes the page", async () => {
		const h = ceremonyHost({
			[`${EVENTS} public/booking`]: () =>
				ok({ bookingRef: REF, status: "cancelled", waiver: { refs: [], voids: { [`${REF}:1`]: VOID } } }),
		});
		expect(await run(h, post(`${WAIVER_PATH}?ref=${REF}`, SIGN_FORM), cookies)).toMatchObject({
			type: "error",
			code: "BOOKING_EXPIRED",
		});
	});
});

describe("the signing page cannot redirect a post off the site (T155)", () => {
	const site = new URL(`${ORIGIN}${WAIVER_PATH}?ref=${REF}`);
	const page = readFileSync(resolve(import.meta.dirname, "../src/astro/WaiverPage.astro"), "utf8");

	it("T155 a payment page leaves the site; the booking page does not", () => {
		expect(leavesSite("https://checkout.stripe.com/c/pay/cs_test_1#abc", site)).toBe(true);
		expect(leavesSite("http://site.example/booking", site)).toBe(true);
		expect(leavesSite(`/booking?ref=${REF}&waiver=signed`, site)).toBe(false);
		expect(leavesSite(`${ORIGIN}/booking?ref=${REF}`, site)).toBe(false);
	});

	it("T155 the page redirects only within the site, and sends a browser on to the payment page without a form", () => {
		expect(page).toContain(`outcome.type === "redirect" && !leavesSite(outcome.location, Astro.url)`);
		expect(page).toContain(`http-equiv="refresh" content={\`0;url=\${payment}\`}`);
		expect(page).toContain(`href={payment}`);
	});
});

describe("payment after the last receipt (T077, EU-FR-09)", () => {
	const BOOKING_COOKIE = { [`semics_booking_${REF}`]: ACCESS };
	const LAST = { [flowCookieName(REF)]: SIGNING(2) };
	const payNext = () =>
		ok({ bookingRef: REF, status: "awaiting_payment", next: { type: "pay", url: "https://pay.example/s/1" } });
	const lastReceipt = (h: ReturnType<typeof host>, cookies: Record<string, string> = { ...LAST, ...BOOKING_COOKIE }) =>
		run(h, post(`${WAIVER_PATH}?ref=${REF}`, SIGN_FORM), cookies);

	it("EU-FR-09 the last signature of a paid waiver booking continues it again and goes to the payment page", async () => {
		const h = ceremonyHost({ [`${EVENTS} public/checkout/continue`]: payNext });
		const outcome = expectRedirect(await lastReceipt(h));
		expect(h.calls.at(-1)).toEqual({
			id: EVENTS,
			path: "public/checkout/continue",
			body: { bookingRef: REF, accessToken: ACCESS },
		});
		expect(outcome.location).toBe("https://pay.example/s/1");
		expect(cookieValue(outcome, flowCookieName(REF))?.options).toMatchObject({ maxAge: 0 });
	});

	it("EU-FR-09 a free waiver booking, or one still waiting on other signers, lands on the booking page as before", async () => {
		const done = ceremonyHost({
			[`${EVENTS} public/checkout/continue`]: () =>
				ok({ bookingRef: REF, status: "confirmed", next: { type: "done" } }),
		});
		expect(expectRedirect(await lastReceipt(done)).location).toBe(`/booking?ref=${REF}&waiver=signed`);
		const waiting = ceremonyHost({ [`${EVENTS} public/checkout/continue`]: signNext });
		expect(expectRedirect(await lastReceipt(waiting)).location).toBe(`/booking?ref=${REF}&waiver=signed`);
		const refusedContinue = ceremonyHost({ [`${EVENTS} public/checkout/continue`]: () => refused("HOLD_EXPIRED") });
		expect(expectRedirect(await lastReceipt(refusedContinue)).location).toBe(`/booking?ref=${REF}&waiver=signed`);
	});

	it("EU-FR-09 a non-https payment url is not followed, a decline never asks for payment, and without the booking cookie nothing is asked", async () => {
		const bad = ceremonyHost({
			[`${EVENTS} public/checkout/continue`]: () => ok({ next: { type: "pay", url: "javascript:alert(1)" } }),
		});
		expect(expectRedirect(await lastReceipt(bad)).location).toBe(`/booking?ref=${REF}&waiver=signed`);

		const declined = ceremonyHost({
			[`${ESIGN} public/decline`]: () => ok({ returnUrl: RETURN, receipt: RECEIPT(9) }),
			[`${EVENTS} public/checkout/continue`]: payNext,
		});
		const out = expectRedirect(
			await run(declined, post(`${WAIVER_PATH}?ref=${REF}`, { intent: "decline", reason: "No" }), {
				...LAST,
				...BOOKING_COOKIE,
			}),
		);
		expect(out.location).toBe(`/booking?ref=${REF}&waiver=declined`);
		expect(declined.calls.some((c) => c.path === "public/checkout/continue")).toBe(false);

		const bare = ceremonyHost({ [`${EVENTS} public/checkout/continue`]: payNext });
		expect(expectRedirect(await lastReceipt(bare, LAST)).location).toBe(`/booking?ref=${REF}&waiver=signed`);
		expect(bare.calls.some((c) => c.path === "public/checkout/continue")).toBe(false);
	});

	it("EU-FR-09 every other signer already signed elsewhere: the GET goes to payment too", async () => {
		const h = ceremonyHost({
			[`${ESIGN} public/session`]: () =>
				ok({ state: "closed", status: "completed", returnUrl: RETURN, receipt: RECEIPT(2) }),
			[`${EVENTS} public/checkout/continue`]: payNext,
		});
		const outcome = expectRedirect(await run(h, get(`${WAIVER_PATH}?ref=${REF}`), { ...LAST, ...BOOKING_COOKIE }));
		expect(outcome.location).toBe("https://pay.example/s/1");
	});

	it("EU-FR-09 the booking token reaches this page on its own path, and is cleared when the flow ends", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: signNext,
			[`${ESIGN} public/envelopes/from-intent`]: fromIntent(),
		});
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, ORDER)));
		expect(cookieValue(outcome, retryCookieName(REF))).toMatchObject({
			value: ACCESS,
			options: { path: WAIVER_PATH, httpOnly: true, sameSite: "strict" },
		});
		const paid = ceremonyHost({ [`${EVENTS} public/checkout/continue`]: payNext });
		const last = expectRedirect(await lastReceipt(paid, { ...LAST, [retryCookieName(REF)]: ACCESS }));
		expect(last.location).toBe("https://pay.example/s/1");
		expect(cookieValue(last, retryCookieName(REF))?.options).toMatchObject({ maxAge: 0 });
	});
});

describe("retry after e-sign refuses an intent (T066, SX-FR-03)", () => {
	const BOOKING_COOKIE = { [`semics_booking_${REF}`]: ACCESS };
	const retry = () => post(`${WAIVER_PATH}?ref=${REF}`, { intent: "retry" });

	it("SX-FR-03 a retry continues the held booking again without re-sending attendees, then redeems the intents", async () => {
		const h = host({
			[`${EVENTS} public/checkout/continue`]: signNext,
			[`${ESIGN} public/envelopes/from-intent`]: fromIntent(),
		});
		const outcome = expectRedirect(await run(h, retry(), BOOKING_COOKIE));
		// No `attendees`: Events keeps the stored ones and Pro skips seats already signed.
		expect(h.calls[0]).toEqual({
			id: EVENTS,
			path: "public/checkout/continue",
			body: { bookingRef: REF, accessToken: ACCESS },
		});
		expect(outcome.location).toBe(`${WAIVER_PATH}?ref=${REF}`);
		expect(cookieValue(outcome, flowCookieName(REF))?.value).toBe(`${SIGNING(1)}.${SIGNING(2)}`);
	});

	it("SX-FR-03 e-sign refusing again offers the retry again; a lapsed hold says so; no booking cookie goes to the booking", async () => {
		const again = host({
			[`${EVENTS} public/checkout/continue`]: signNext,
			[`${ESIGN} public/envelopes/from-intent`]: () => refused("TEMPLATE_NOT_FOUND"),
		});
		expect(expectRedirect(await run(again, retry(), BOOKING_COOKIE)).location).toBe(
			`${WAIVER_PATH}?ref=${REF}&error=SIGNING_UNAVAILABLE`,
		);
		const lapsed = host({ [`${EVENTS} public/checkout/continue`]: () => refused("HOLD_EXPIRED") });
		expect(expectRedirect(await run(lapsed, retry(), BOOKING_COOKIE)).location).toBe(
			`${WAIVER_PATH}?ref=${REF}&error=HOLD_EXPIRED`,
		);
		const none = host({});
		expect(expectRedirect(await run(none, retry())).location).toBe(`/booking?ref=${REF}`);
		expect(none.calls).toEqual([]);
	});

	it("T067 SX-FR-03 the retry works in a browser: the page that offers it can read the booking's access", async () => {
		// A browser sends a cookie only to paths under its Path: the booking cookie (Path=/booking)
		// never reaches /_events/waiver, so the flow must leave the retry its own credential there.
		const first = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: signNext,
			[`${ESIGN} public/envelopes/from-intent`]: () => refused("TEMPLATE_NOT_FOUND"),
		});
		const refusedOnce = expectRedirect(await run(first, post(WAIVER_PATH, ORDER)));
		expect(refusedOnce.location).toBe(`${WAIVER_PATH}?ref=${REF}&error=SIGNING_UNAVAILABLE`);
		const jar = browserJar(refusedOnce.cookies, WAIVER_PATH);
		for (const c of refusedOnce.cookies.filter((c) => c.options.path === WAIVER_PATH)) {
			expect(c.options).toMatchObject({ httpOnly: true, sameSite: "strict", secure: true });
		}

		const again = host({
			[`${EVENTS} public/checkout/continue`]: signNext,
			[`${ESIGN} public/envelopes/from-intent`]: fromIntent(),
		});
		const outcome = expectRedirect(await run(again, retry(), jar));
		expect(again.calls[0]).toEqual({
			id: EVENTS,
			path: "public/checkout/continue",
			body: { bookingRef: REF, accessToken: ACCESS },
		});
		expect(outcome.location).toBe(`${WAIVER_PATH}?ref=${REF}`);
		expect(outcome.location).not.toContain(ACCESS);
	});

	it("T119 F13 the retry cookie is cleared once the flow moves on without this page (done, pay, only email signers)", async () => {
		const RETRY = { [retryCookieName(REF)]: ACCESS };
		const emailOnly = () =>
			ok({
				bookingRef: REF,
				status: "awaiting_signature",
				next: { type: "sign", intents: [{ ref: `${REF}:3`, delivery: "email", as: "self", token: INTENT(3) }] },
			});
		for (const [name, answer, location] of [
			[
				"done (Free after a downgrade)",
				() => ok({ bookingRef: REF, status: "confirmed", next: { type: "done" } }),
				`/booking?ref=${REF}`,
			],
			[
				"pay",
				() => ok({ bookingRef: REF, next: { type: "pay", url: "https://pay.example/s/1" } }),
				"https://pay.example/s/1",
			],
			["only email signers left", emailOnly, `/booking?ref=${REF}`],
		] as const) {
			const h = host({
				[`${EVENTS} public/checkout/continue`]: answer,
				[`${ESIGN} public/envelopes/from-intent`]: fromIntent(),
			});
			const outcome = expectRedirect(await run(h, retry(), RETRY));
			expect(outcome.location, name).toBe(location);
			expect(cookieValue(outcome, retryCookieName(REF))?.options, name).toMatchObject({ maxAge: 0 });
		}
	});

	it("T119 F13 a decline ends the flow and clears the retry cookie too", async () => {
		const h = ceremonyHost();
		const cookies = { [flowCookieName(REF)]: SIGNING(9), [retryCookieName(REF)]: ACCESS };
		const outcome = expectRedirect(
			await run(h, post(`${WAIVER_PATH}?ref=${REF}`, { intent: "decline", reason: "No" }), cookies),
		);
		expect(outcome.location).toBe(`/booking?ref=${REF}&waiver=declined`);
		expect(cookieValue(outcome, retryCookieName(REF))?.options).toMatchObject({ maxAge: 0 });
	});

	it("T119 F8 too many emailed adults in one order goes back to the widget with its own message", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: () =>
				refused("BAD_REQUEST", [{ path: "attendees", code: "WAIVER_TOO_MANY_EMAILS" }]),
			[`${EVENTS} public/booking/cancel`]: () => ok({ status: "cancelled" }),
		});
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, ORDER)));
		expect(new URL(outcome.location, ORIGIN).searchParams.get("waiver_error")).toBe("WAIVER_TOO_MANY_EMAILS");
		expect(WAIVER_MESSAGES.WAIVER_TOO_MANY_EMAILS).toMatch(/email/);
	});

	it("SX-FR-03 a retry for a malformed ref, or from another site, does nothing", async () => {
		const h = host({});
		const bad = post(`${WAIVER_PATH}?ref=nope`, { intent: "retry" });
		expect(expectRedirect(await run(h, bad, BOOKING_COOKIE)).location).toBe("/booking");
		const cross = post(`${WAIVER_PATH}?ref=${REF}`, { intent: "retry" }, { "sec-fetch-site": "cross-site" });
		expect(await run(h, cross, BOOKING_COOKIE)).toEqual({ type: "forbidden" });
		expect(h.calls).toEqual([]);
	});
});

describe("an event without a required waiver (T066, SX-FR-02)", () => {
	const PLAIN = {
		intent: "book",
		plain: "1",
		eventId: "ev_1",
		returnTo: "/events/climb",
		idempotencyKey: "k".repeat(43),
		name: "Ada Lovelace",
		email: "ada@example.com",
		ticketTypeId: "tt_adult",
		qty: "3",
	};

	it("SX-FR-02 books the tickets with no attendee rows, so Events plans the seats itself", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/checkout/continue`]: () =>
				ok({ bookingRef: REF, status: "confirmed", next: { type: "done", bookingRef: REF } }),
		});
		const outcome = expectRedirect(await run(h, post(WAIVER_PATH, PLAIN)));
		expect(outcome.location).toBe(`/booking?ref=${REF}`);
		expect(h.calls[0]?.body).toMatchObject({ lines: [{ ticketTypeId: "tt_adult", qty: 3 }] });
		expect(h.calls[1]?.body).toEqual({ bookingRef: REF, accessToken: ACCESS });
	});
});

// T166 (T163 §6): reserve, then hold with Vouchers, then continue with the hold token. No JavaScript.
describe("T166 R16 a gift voucher code in <BookingWithWaiver>", () => {
	const VOUCHERS = "r_vouchers1";
	const WITH_VOUCHERS = { ...IDS, vouchersPluginId: VOUCHERS };
	const HOLD = `${"h".repeat(40)}.${"s".repeat(43)}`;
	const ORDER_WITH_CODE = {
		intent: "book",
		plain: "1",
		eventId: "ev_1",
		returnTo: "/events/climb",
		idempotencyKey: "k".repeat(43),
		name: "Ada Lovelace",
		email: "ada@example.com",
		ticketTypeId: "tt_adult",
		qty: "1",
		voucherCode: " abcd-efgh-jkmn-pqrs ",
	};
	const booked = () =>
		ok({
			bookingRef: REF,
			eventId: "ev_1",
			lines: [{ ticketTypeId: "tt_adult", qty: 1, unitPriceMinor: 3000 }],
			totals: { totalMinor: 3000, currency: "GBP" },
		});
	const runWith = (
		h: ReturnType<typeof host>,
		request: Request,
		ids: typeof IDS & { vouchersPluginId?: string } = WITH_VOUCHERS,
	) =>
		handleWaiverRequest({ locals: h.locals, url: new URL(request.url), request, cookie: () => undefined }, ids, {
			newKey: () => "n".repeat(43),
		});

	it("R16 reserve, then hold, then continue with the hold token: a fully paid booking lands on its page", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/booking`]: booked,
			[`${VOUCHERS} public/redeem/hold`]: () => ok({ hold: HOLD }),
			[`${EVENTS} public/checkout/continue`]: () =>
				ok({ bookingRef: REF, status: "confirmed", next: { type: "done", bookingRef: REF } }),
		});
		const outcome = expectRedirect(await runWith(h, post(WAIVER_PATH, ORDER_WITH_CODE)));
		expect(outcome.location).toBe(`/booking?ref=${REF}`);
		// T168: the code is checked first (here Vouchers has no check route, which never blocks).
		expect(h.calls.map((c) => c.path)).toEqual([
			"public/redeem/check",
			"public/checkout/reserve",
			"public/booking",
			"public/redeem/hold",
			"public/checkout/continue",
		]);
		expect(h.calls[1]?.body).not.toHaveProperty("voucherCode");
		expect(h.calls[3]?.body).toMatchObject({ code: "abcd-efgh-jkmn-pqrs", ref: REF, dueMinor: 3000 });
		expect(h.calls[4]?.body).toEqual({ bookingRef: REF, accessToken: ACCESS, voucherHold: HOLD });
	});

	it("R16 a refused code cancels the hold and returns to the widget on the voucher field", async () => {
		const h = host({
			[`${EVENTS} public/checkout/reserve`]: reserve,
			[`${EVENTS} public/booking`]: booked,
			[`${VOUCHERS} public/redeem/hold`]: () => refused("VOUCHER_WRONG_ACTIVITY"),
			[`${EVENTS} public/booking/cancel`]: () => ok({ status: "cancelled" }),
		});
		const outcome = expectRedirect(await runWith(h, post(WAIVER_PATH, ORDER_WITH_CODE)));
		expect(outcome.location).toContain("waiver_error=VOUCHER_WRONG_ACTIVITY");
		expect(outcome.location).toContain("waiver_fields=voucher");
		expect(h.calls.map((c) => c.path)).toContain("public/booking/cancel");
		expect(h.calls.map((c) => c.path)).not.toContain("public/checkout/continue");
	});

	it("T168 R16 a mistyped, expired or spent code is refused before reserving: no booking, no cancel, no email", async () => {
		const h = host({ [`${VOUCHERS} public/redeem/check`]: () => refused("VOUCHER_INVALID") });
		const outcome = expectRedirect(await runWith(h, post(WAIVER_PATH, ORDER_WITH_CODE)));
		expect(outcome.location).toContain("waiver_error=VOUCHER_INVALID");
		expect(outcome.location).toContain("waiver_fields=voucher");
		expect(outcome.location).not.toContain("abcd");
		expect(h.calls.map((c) => c.path)).toEqual(["public/redeem/check"]);
		expect(h.calls[0]?.body).toEqual({
			code: "abcd-efgh-jkmn-pqrs",
			lines: [{ eventId: "ev_1", ticketTypeId: "tt_adult" }],
		});
	});

	it("R16 without Vouchers configured a typed code is refused before reserving", async () => {
		const h = host({});
		const outcome = expectRedirect(await runWith(h, post(WAIVER_PATH, ORDER_WITH_CODE), IDS));
		expect(outcome.location).toContain("waiver_error=VOUCHER_UNAVAILABLE");
		expect(h.calls).toEqual([]);
	});

	it("R16 the widget shows the field only when public/event says vouchers", () => {
		const source = readFileSync(resolve(import.meta.dirname, "../src/astro/BookingWithWaiver.astro"), "utf8");
		expect(source).toContain("data?.vouchers === true");
		expect(source).toContain('name="voucherCode"');
	});
});

describe("the waiver seat rules, before reserving", () => {
	const order = (attendees: Array<{ name: string; email?: string; minor?: true }>) => ({
		eventId: "ev",
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		attendees: attendees.map((a) => ({ ticketTypeId: "tt", ...a })),
		lines: [{ ticketTypeId: "tt", qty: attendees.length }],
		rows: attendees.map((_, i) => i + 1),
		idempotencyKey: "",
	});

	it("EV-FR-12 the buyer, once, under their own name; minors; other adults at their own address", () => {
		expect(
			checkWaiverSeats(
				order([
					{ name: " ada lovelace " },
					{ name: "Byron", minor: true },
					{ name: "Grace Hopper", email: "grace@example.com" },
				]),
			),
		).toBeNull();
	});

	it("EV-FR-12 another adult with the buyer's address, or none, is refused at that row (PV52PKY5AK)", () => {
		expect(checkWaiverSeats(order([{ name: "Ada Lovelace" }, { name: "Grace", email: "ADA@example.com" }]))).toEqual({
			code: "WAIVER_EMAIL_REQUIRED",
			fields: ["attendee.2.email"],
		});
		expect(checkWaiverSeats(order([{ name: "Grace" }]))).toEqual({
			code: "WAIVER_EMAIL_REQUIRED",
			fields: ["attendee.1.email"],
		});
		expect(checkWaiverSeats(order([{ name: "Ada Lovelace" }, { name: "Ada Lovelace" }]))?.fields).toEqual([
			"attendee.2.email",
		]);
	});

	it("EV-FR-12 at most 10 adults invited by email", () => {
		const others = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `G${i}`, email: `g${i}@example.com` }));
		expect(checkWaiverSeats(order(others(10)))).toBeNull();
		expect(checkWaiverSeats(order(others(11)))?.code).toBe("WAIVER_TOO_MANY_EMAILS");
	});
});

describe("the waiver page's look", () => {
	const page = readFileSync(resolve(import.meta.dirname, "../src/astro/WaiverPage.astro"), "utf8");

	it("EU-NFR-05 uses Events' page stylesheet, allowed by the header by hash, and the site's brand and stylesheet", () => {
		expect(page).toContain("const css = pageCss(page);");
		expect(page).toContain("ceremonyCsp({ styles: [css], stylesheet })");
		expect(page).toContain("<style is:inline set:html={css}></style>");
		expect(page).toContain("<PageBrand brand={page.brand} />");
		expect(page).not.toMatch(/^<style>/m);
	});

	it("T151 'Book again' follows the site's own event page", () => {
		expect(page).toContain("eventPath: page.eventPath");
	});
});
