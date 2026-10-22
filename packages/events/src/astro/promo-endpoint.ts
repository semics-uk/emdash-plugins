// Injected at `/_events/promo` by the integration: the booking widget's "Apply" button (a plain form
// post, no JavaScript needed). Cross-site posts get a 403 before anything runs (`isCrossSiteRequest`).
import { pluginId } from "virtual:semics-events/config";

import { handlePromoRequest, type PromoEndpointContext } from "./lib/promo";

export const prerender = false;

export function POST(ctx: PromoEndpointContext): Promise<Response> {
	return handlePromoRequest(ctx, { pluginId });
}
