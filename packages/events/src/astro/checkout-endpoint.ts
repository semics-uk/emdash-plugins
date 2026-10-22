// Injected at `/_events/checkout` by the integration. A plain form post (no JavaScript needed).
// Cross-site posts get a 403 before anything runs (`isCrossSiteRequest`, T057).
import { pluginId } from "virtual:semics-events/config";

import { type CheckoutEndpointContext, handleCheckoutRequest } from "./lib/checkout-form";

export const prerender = false;

export function POST(ctx: CheckoutEndpointContext): Promise<Response> {
	return handleCheckoutRequest(ctx, { pluginId });
}
