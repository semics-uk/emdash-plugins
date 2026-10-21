import { toRouteError } from "@semics-tech/shared";
import type { SandboxedPlugin } from "emdash/plugin";

import { CHECKOUT_RESERVE_ROUTE } from "./checkout-reserve";

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

const EVENTS_LIST_CACHE = "public, max-age=60, stale-while-revalidate=300";

export const PUBLIC_ROUTES: Record<string, RouteDef> = {
	"public/events": route({ methods: ["GET"], cacheControl: EVENTS_LIST_CACHE }),
	"public/event": route({ methods: ["GET"] }),
	"public/checkout/reserve": CHECKOUT_RESERVE_ROUTE,
	"public/checkout/continue": route({ methods: ["POST"] }),
	"public/booking": route({ methods: ["POST"] }),
	"public/booking/cancel": route({ methods: ["POST"] }),
	"public/booking/ics": route({ methods: ["GET"], response: "raw" }),
	"public/event/ics": route({ methods: ["GET"], response: "raw" }),
	"public/waitlist/join": route({ methods: ["POST"] }),
	"public/waitlist/claim": route({ methods: ["POST"] }),
	"webhooks/stripe": route({
		methods: ["POST"],
		request: { body: "text", headers: ["stripe-signature"] },
	}),
	"signatures/receipt": route({ methods: ["POST"] }),
};
