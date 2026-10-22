// Injected at `/_esign/start` by the integration. A plain form post (no JavaScript needed).
// Cross-site posts get a 403 before anything runs (`isCrossSiteRequest`).
import { pluginId } from "virtual:semics-esign/config";

import { handleStartRequest, type StartEndpointContext } from "./lib/self-serve.ts";

export const prerender = false;

export function POST(ctx: StartEndpointContext): Promise<Response> {
	return handleStartRequest(ctx, { pluginId });
}
