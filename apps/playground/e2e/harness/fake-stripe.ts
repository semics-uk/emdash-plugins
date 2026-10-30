// A fake Stripe for the Pro e2e specs (T135), run inside the Playwright process. The server reaches it
// through `stripe-preload.mjs` (E2E_STRIPE_URL). It answers the requests Events Pro makes, the way the
// Pro repo's editions tests fake them with `host.http.respond`, but with state: Checkout Sessions
// (payment, manual capture or setup), capture, cancel, off-session charges (`refuseCharges` makes them
// fail with a declined card), setup intents and refunds. `complete()` builds the
// `checkout.session.completed` event a buyer finishing Checkout would cause, signed with the webhook
// secret the spec saved, so the spec delivers it to the site's real `webhooks/stripe` route.
import { createHmac } from "node:crypto";
import { createServer, type Server } from "node:http";

export const WEBHOOK_SECRET = "whsec_test_t135_0123456789abcdefghij";
export const SECRET_KEY = "sk_test_51T135Example";
/** Where the session URLs point; the specs answer it with `page.route` (no Stripe page is loaded). */
export const CHECKOUT_HOST = "https://checkout.stripe.test";

export interface Session {
	id: string;
	form: URLSearchParams;
	mode: "payment" | "setup";
	hold: string | null;
	amount: number | null;
	currency: string;
	paymentIntent: string | null;
	setupIntent: string | null;
	customer: string | null;
	status: "open" | "complete";
}

export interface Intent {
	id: string;
	status: "requires_capture" | "succeeded" | "canceled";
	amount: number;
	currency: string;
}

export interface FakeStripe {
	url: string;
	sessions: Map<string, Session>;
	intents: Map<string, Intent>;
	/** Every request as `METHOD path` (e.g. `POST payment_intents/pi_1/capture`). */
	calls: string[];
	refunds: string[];
	/** When true, off-session charges are declined (a bank that wants the customer). */
	refuseCharges: boolean;
	/** The latest session for a booking ref. */
	sessionFor(ref: string): Session | undefined;
	/** The signed `checkout.session.completed` delivery for a session (marks it complete). */
	complete(session: Session): { body: string; signature: string };
	close(): Promise<void>;
}

let seq = 0;
const next = (prefix: string) => `${prefix}_t135_${Date.now().toString(36)}${(++seq).toString(36)}`;

function json(res: import("node:http").ServerResponse, status: number, body: unknown) {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

export function signature(body: string, secret = WEBHOOK_SECRET): string {
	const t = Math.floor(Date.now() / 1000);
	return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export async function startFakeStripe(port: number): Promise<FakeStripe> {
	const sessions = new Map<string, Session>();
	const byKey = new Map<string, Session>();
	const intents = new Map<string, Intent>();
	const charges = new Map<string, { status: number; body: unknown }>();
	const state = { refuseCharges: false };
	const calls: string[] = [];
	const refunds: string[] = [];

	const server: Server = createServer((req, res) => {
		let raw = "";
		req.on("data", (chunk) => {
			raw += chunk;
		});
		req.on("end", () => {
			const path = (req.url ?? "/").replace(/^\/(v1\/)?/, "");
			calls.push(`${req.method} ${path}`);
			const form = new URLSearchParams(raw);
			const key = String(req.headers["idempotency-key"] ?? "");
			const parts = path.split("/").map(decodeURIComponent);

			if (req.method === "POST" && path === "checkout/sessions") {
				const known = key ? byKey.get(key) : undefined;
				if (known) return json(res, 200, { id: known.id, url: `${CHECKOUT_HOST}/c/${known.id}` });
				const mode = form.get("mode") === "setup" ? "setup" : "payment";
				const s: Session = {
					id: next("cs_test"),
					form,
					mode,
					hold: form.get("metadata[hold]"),
					amount: mode === "payment" ? Number(form.get("line_items[0][price_data][unit_amount]")) : null,
					currency: (form.get("currency") ?? form.get("line_items[0][price_data][currency]") ?? "gbp").toLowerCase(),
					paymentIntent: null,
					setupIntent: null,
					customer: null,
					status: "open",
				};
				sessions.set(s.id, s);
				if (key) byKey.set(key, s);
				return json(res, 200, { id: s.id, url: `${CHECKOUT_HOST}/c/${s.id}` });
			}
			if (req.method === "GET" && parts[0] === "checkout" && parts[1] === "sessions" && parts[2]) {
				const s = sessions.get(parts[2]);
				if (!s) return json(res, 404, { error: { code: "resource_missing" } });
				return json(res, 200, sessionObject(s));
			}
			if (req.method === "POST" && parts[0] === "payment_intents" && parts[2] === "capture") {
				const pi = intents.get(parts[1] ?? "");
				if (!pi) return json(res, 404, { error: { code: "resource_missing" } });
				if (pi.status === "requires_capture") pi.status = "succeeded";
				if (pi.status !== "succeeded") {
					return json(res, 400, { error: { code: "payment_intent_unexpected_state", payment_intent: intentObject(pi) } });
				}
				return json(res, 200, intentObject(pi));
			}
			if (req.method === "POST" && parts[0] === "payment_intents" && parts[2] === "cancel") {
				const pi = intents.get(parts[1] ?? "");
				if (!pi) return json(res, 404, { error: { code: "resource_missing" } });
				if (pi.status === "requires_capture") pi.status = "canceled";
				if (pi.status !== "canceled") {
					return json(res, 400, { error: { code: "payment_intent_unexpected_state", payment_intent: intentObject(pi) } });
				}
				return json(res, 200, intentObject(pi));
			}
			if (req.method === "POST" && path === "payment_intents") {
				const replay = key ? charges.get(key) : undefined;
				if (replay) return json(res, replay.status, replay.body);
				const pi: Intent = {
					id: next("pi"),
					status: "succeeded",
					amount: Number(form.get("amount")),
					currency: String(form.get("currency")),
				};
				let answer: { status: number; body: unknown };
				if (state.refuseCharges) {
					const failed = { ...intentObject(pi), status: "requires_payment_method", amount_received: 0 };
					answer = { status: 402, body: { error: { code: "authentication_required", payment_intent: failed } } };
				} else {
					intents.set(pi.id, pi);
					answer = { status: 200, body: intentObject(pi) };
				}
				if (key) charges.set(key, answer);
				return json(res, answer.status, answer.body);
			}
			if (req.method === "GET" && parts[0] === "setup_intents" && parts[1]) {
				const s = [...sessions.values()].find((x) => x.setupIntent === parts[1]);
				if (!s) return json(res, 404, { error: { code: "resource_missing" } });
				return json(res, 200, { id: parts[1], status: "succeeded", payment_method: `pm_for_${s.id}` });
			}
			if (req.method === "POST" && path === "refunds") {
				refunds.push(String(form.get("payment_intent")));
				const pi = intents.get(String(form.get("payment_intent")));
				return json(res, 200, { id: next("re"), amount: pi?.amount ?? 0, status: "succeeded" });
			}
			return json(res, 404, { error: { code: "resource_missing", message: `fake Stripe: ${req.method} ${path}` } });
		});
	});

	function sessionObject(s: Session) {
		return {
			id: s.id,
			object: "checkout.session",
			status: s.status,
			mode: s.mode,
			client_reference_id: s.form.get("client_reference_id"),
			metadata: {
				bookingId: s.form.get("metadata[bookingId]"),
				bookingRef: s.form.get("metadata[bookingRef]"),
				...(s.hold ? { hold: s.hold } : {}),
			},
			payment_status: s.status !== "complete" ? "unpaid" : s.mode === "setup" ? "no_payment_required" : s.hold ? "unpaid" : "paid",
			payment_intent: s.paymentIntent,
			setup_intent: s.setupIntent,
			customer: s.customer,
			amount_total: s.amount,
			currency: s.currency,
		};
	}

	function intentObject(pi: Intent) {
		return {
			id: pi.id,
			object: "payment_intent",
			status: pi.status,
			amount: pi.amount,
			amount_received: pi.status === "succeeded" ? pi.amount : 0,
			currency: pi.currency,
		};
	}

	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(port, "127.0.0.1", () => resolve());
	});

	return {
		url: `http://127.0.0.1:${port}`,
		sessions,
		intents,
		calls,
		refunds,
		get refuseCharges() {
			return state.refuseCharges;
		},
		set refuseCharges(value: boolean) {
			state.refuseCharges = value;
		},
		sessionFor(ref) {
			return [...sessions.values()].filter((s) => s.form.get("metadata[bookingRef]") === ref).at(-1);
		},
		complete(s) {
			if (s.mode === "setup") {
				s.setupIntent ??= next("seti");
				s.customer ??= next("cus");
			} else if (!s.paymentIntent) {
				const pi: Intent = {
					id: next("pi"),
					status: s.hold === "manual" ? "requires_capture" : "succeeded",
					amount: s.amount ?? 0,
					currency: s.currency,
				};
				intents.set(pi.id, pi);
				s.paymentIntent = pi.id;
			}
			s.status = "complete";
			const body = JSON.stringify({
				id: next("evt"),
				object: "event",
				type: "checkout.session.completed",
				data: { object: sessionObject(s) },
			});
			return { body, signature: signature(body) };
		},
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}
