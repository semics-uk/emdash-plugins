import { toRouteError } from "@semics-tech/shared";
import type { SandboxedPlugin } from "emdash/plugin";

import { BOOKING_CANCEL_ROUTE, BOOKING_ROUTE } from "./booking";
import { CHECKOUT_CONTINUE_ROUTE } from "./checkout-continue";
import { CHECKOUT_RESERVE_ROUTE } from "./checkout-reserve";
import { bookingIcsHandler, eventIcsHandler } from "./ics";
import { EVENT_ROUTE, EVENTS_LIST_ROUTE } from "./public-events";
import { BOOKING_REDEEM_ROUTE } from "./redeem";

/**
 * Every public route of BUILD-PLAN 3.1. Routes are declared in code (the manifest schema has no
 * route section), so this list is the public-surface part of the trust contract: installing the
 * plugin shows the site owner each of these. Handlers are stubs until their task lands; each one
 * answers through the shared error registry and reveals nothing.
 */
type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];

const notImplemented = async () => toRouteError("NOT_FOUND").body;

function route(def: Omit<RouteDef, "handler" | "public">): RouteDef {
	return { ...def, public: true, handler: notImplemented };
}

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
	"public/waitlist/join": route({ methods: ["POST"] }),
	"public/waitlist/claim": route({ methods: ["POST"] }),
	"webhooks/stripe": route({
		methods: ["POST"],
		request: { body: "text", headers: ["stripe-signature"] },
	}),
	"signatures/receipt": route({ methods: ["POST"] }),
};
