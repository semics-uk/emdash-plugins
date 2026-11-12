// Provided by the integration's Vite plugin (`eventsIntegration({ pluginId })`).
declare module "virtual:semics-events/config" {
	export const pluginId: string;
	/** How the site dresses the plugin's own pages (`eventsIntegration({ page })`). */
	export const page: import("./lib/page").PageOptions;
	/** The e-sign core's plugin id, or `null` when e-sign is not configured (`eventsIntegration({ esignPluginId })`). */
	export const esignPluginId: string | null;
	/**
	 * The suite's reconciliation of a booking that waits for signatures (T066), or `null` without the suite
	 * (`eventsIntegration({ reconcile })`). Forwards the receipts e-sign already has; resolves with how many.
	 */
	export const reconcile:
		| ((
				ctx: import("./lib/call").PublicRouteContext,
				input: {
					booking: import("./lib/widget").BookingView;
					pluginId: string;
					esignPluginId: string;
					vouchersPluginId?: string;
				},
		  ) => Promise<{ forwarded: number }>)
		| null;
	/** Gift vouchers (T166): only exported with `eventsIntegration({ vouchers })`; read through a namespace import. */
	export const vouchersPluginId: string | undefined;
	export const holdVoucher:
		| ((
				ctx: import("./lib/call").PublicRouteContext,
				input: { code: string; bookingRef: string; accessToken: string },
				ids: { eventsPluginId: string; vouchersPluginId: string },
		  ) => Promise<import("./lib/checkout-form").VoucherHoldResult>)
		| undefined;
}
