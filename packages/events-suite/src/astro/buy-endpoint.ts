// Injected at `/_vouchers/buy` by `eventsSuite({ vouchers })` (T168): <BuyVoucher>'s plain form post. Asks Vouchers
// for a Checkout Session in process and sends the buyer to Stripe (303); cross-site posts get a 403.
import * as config from "virtual:semics-events-suite/config";
import { crossSiteResponse } from "@semics-tech/emdash-events/astro/lib/checkout-form";

import { type BuyRequestContext, handleBuyRequest } from "./lib/buy";

export const prerender = false;

const vouchersPluginId = (config as Partial<typeof config>).vouchersPluginId ?? "";

export async function POST(ctx: BuyRequestContext & { redirect(location: string, status?: number): Response }) {
	const out = await handleBuyRequest(ctx, { vouchersPluginId });
	if (out.type === "forbidden") return crossSiteResponse();
	return new Response(null, { status: 303, headers: { location: out.location, "cache-control": "no-store" } });
}
