// Injected at `/_events/checkout` by the integration. A plain form post (no JavaScript needed).
// Cross-site posts get a 403 before anything runs (`isCrossSiteRequest`, T057).
// With `eventsIntegration({ vouchers })` a typed gift voucher code is held through the suite's hook (T166).
import * as config from "virtual:semics-events/config";

import { type CheckoutEndpointContext, handleCheckoutRequest, type VoucherHook } from "./lib/checkout-form";

export const prerender = false;

const { pluginId, vouchersPluginId, holdVoucher } = config as Partial<typeof config> & { pluginId: string };
const voucher: VoucherHook | undefined =
	holdVoucher && vouchersPluginId
		? (ctx, input) => holdVoucher(ctx, input, { eventsPluginId: pluginId, vouchersPluginId })
		: undefined;

export function POST(ctx: CheckoutEndpointContext): Promise<Response> {
	return handleCheckoutRequest(ctx, { pluginId, ...(voucher ? { voucher } : {}) });
}
