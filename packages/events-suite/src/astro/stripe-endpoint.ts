// Injected at `/_semics/stripe` by `eventsSuite({ vouchers })` (T163 §4a, T166): the site's one Stripe webhook
// endpoint. Routes each delivery by its session's `metadata.plugin`; the plugin verifies the signature.
import * as config from "virtual:semics-events-suite/config";

import { routeStripeWebhook, type StripeEndpointContext } from "./lib/stripe";

export const prerender = false;

const { eventsPluginId, vouchersPluginId } = config as Partial<typeof config> & { eventsPluginId: string };

export function POST(ctx: StripeEndpointContext): Promise<Response> {
	return routeStripeWebhook(ctx, { eventsPluginId, ...(vouchersPluginId ? { vouchersPluginId } : {}) });
}
