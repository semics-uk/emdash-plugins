import { pluginResponse, type RouteHandler, type SandboxedPlugin } from "emdash/plugin";
import { BOOKING_CANCEL_ROUTE, BOOKING_ROUTE } from "./booking";
import { CHECKOUT_CONTINUE_ROUTE } from "./checkout-continue";
import { CHECKOUT_RESERVE_ROUTE } from "./checkout-reserve";
import { bookingIcsHandler, eventIcsHandler } from "./ics";
import { EVENT_ROUTE, EVENTS_LIST_ROUTE } from "./public-events";
import { BOOKING_REDEEM_ROUTE } from "./redeem";
import { routeError } from "./reply";
import { WAITLIST_ROUTES } from "./waitlist";

/**
 * Every public route of BUILD-PLAN 3.1. Routes are declared in code (the manifest schema has no
 * route section), so this list is the public-surface part of the trust contract: installing the
 * plugin shows the site owner each of these. Handlers are stubs until their task lands; each one
 * answers through the shared error registry and reveals nothing.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];

const notImplemented = async () => routeError("NOT_FOUND").body;

function route(def: Omit<RouteDef, "handler" | "public">): RouteDef {
	return { ...def, public: true, handler: notImplemented };
}

/**
 * Free takes no payments, but a site switched back from Pro may still get Stripe deliveries for
 * sessions Pro opened. A 2xx would tell Stripe they were handled and it would never send them again,
 * so a payment made meanwhile would be lost; 503 makes Stripe keep retrying (for up to three days),
 * and Pro settles it (confirm, re-reserve or refund, R2) once it is back (T078). Nothing is read.
 */
const stripeNotHandled: RouteHandler = async () =>
	pluginResponse({
		status: 503,
		headers: { "content-type": "application/json; charset=utf-8", "retry-after": "3600" },
		body: { kind: "text", value: '{"error":"WEBHOOK_NOT_HANDLED"}' },
	});

export const PUBLIC_ROUTES: Record<string, RouteDef> = {
	"public/events": EVENTS_LIST_ROUTE,
	"public/event": EVENT_ROUTE,
	"public/checkout/reserve": CHECKOUT_RESERVE_ROUTE,
	"public/checkout/continue": CHECKOUT_CONTINUE_ROUTE,
	"public/booking": BOOKING_ROUTE,
	"public/booking/cancel": BOOKING_CANCEL_ROUTE,
	"public/booking/redeem": BOOKING_REDEEM_ROUTE,
	"public/booking/ics": { methods: ["GET"], public: true, response: "raw", handler: bookingIcsHandler },
	"public/event/ics": {
		methods: ["GET"],
		public: true,
		response: "raw",
		cacheControl: "public, max-age=300",
		handler: eventIcsHandler,
	},
	...WAITLIST_ROUTES,
	"webhooks/stripe": {
		methods: ["POST"],
		public: true,
		response: "raw",
		request: { body: "text", headers: ["stripe-signature"] },
		handler: stripeNotHandled,
	},
	"signatures/receipt": route({ methods: ["POST"] }),
};
