// Provided by the integration's Vite plugin (`eventsIntegration({ pluginId })`).
declare module "virtual:semics-events/config" {
	export const pluginId: string;
	/** The e-sign core's plugin id, or `null` when e-sign is not configured (`eventsIntegration({ esignPluginId })`). */
	export const esignPluginId: string | null;
	/**
	 * The suite's reconciliation of a booking that waits for signatures (T066), or `null` without the suite
	 * (`eventsIntegration({ reconcile })`). Forwards the receipts e-sign already has; resolves with how many.
	 */
	export const reconcile:
		| ((
				ctx: import("./lib/call").PublicRouteContext,
				input: { booking: import("./lib/widget").BookingView; pluginId: string; esignPluginId: string },
		  ) => Promise<{ forwarded: number }>)
		| null;
}
