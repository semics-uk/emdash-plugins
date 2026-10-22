// Injected at `/_events/waitlist` by the integration: the booking widget's "Join the waitlist" form (a
// plain form post, no JavaScript needed). Cross-site posts get a 403 before anything runs.
import { pluginId } from "virtual:semics-events/config";

import type { CheckoutEndpointContext } from "./lib/checkout-form";
import { handleWaitlistRequest } from "./lib/waitlist";

export const prerender = false;

export function POST(ctx: CheckoutEndpointContext): Promise<Response> {
	return handleWaitlistRequest(ctx, { pluginId });
}
