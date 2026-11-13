// Injected at `/_events/checkout` by the integration. A plain form post (no JavaScript needed).
// Cross-site posts get a 403 before anything runs (`isCrossSiteRequest`, T057).
// With `eventsIntegration({ vouchers })` a typed gift voucher code is held through the suite's hook (T166).
import * as config from "virtual:semics-events/config";

import {
	type CheckoutEndpointContext,
	handleCheckoutRequest,
	type VoucherCheckHook,
	type VoucherHook,
} from "./lib/checkout-form";

export const prerender = false;

const { pluginId, vouchersPluginId, holdVoucher, checkVoucher } = config as Partial<typeof config> & {
	pluginId: string;
};
const voucher: VoucherHook | undefined =
	holdVoucher && vouchersPluginId
		? (ctx, input) => holdVoucher(ctx, input, { eventsPluginId: pluginId, vouchersPluginId })
		: undefined;

// T168: the code is checked before reserving, so a refused one leaves no booking (and no "cancelled" email).
const check: VoucherCheckHook | undefined =
	checkVoucher && vouchersPluginId ? (ctx, input) => checkVoucher(ctx, input, { vouchersPluginId }) : undefined;

export function POST(ctx: CheckoutEndpointContext): Promise<Response> {
	return handleCheckoutRequest(ctx, { pluginId, ...(voucher ? { voucher } : {}), ...(check ? { check } : {}) });
}
