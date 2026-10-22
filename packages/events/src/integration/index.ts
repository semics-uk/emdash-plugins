import { EVENTS_PLUGIN_ID } from "../astro/lib/call.ts";

export interface EventsIntegrationOptions {
	/**
	 * The sandboxed core's plugin id. Defaults to the slug (`semics-events`, npm installs).
	 * Registry installs get an `r_…` id: pass it here.
	 */
	pluginId?: string;
	/**
	 * The e-sign core's plugin id, when `semics-esign` runs on the same site (the suite passes it).
	 * Enables the receipt lookup on the waiver return page and the door signing page
	 * (`/_events/sign`); without it the door signing page says signing is not set up.
	 */
	esignPluginId?: string;
	/**
	 * A module that exports `reconcileBooking(ctx, { booking, pluginId, esignPluginId })`, run by the booking page
	 * for a booking waiting for signatures (the suite passes its own, T066). Without it nothing is reconciled.
	 */
	reconcile?: string;
}

const VIRTUAL = "virtual:semics-events/config";
const RESOLVED = `\0${VIRTUAL}`;

/** The slice of Astro's integration API this needs (so the package takes no `astro` dependency). */
interface SetupArgs {
	injectRoute(route: { pattern: string; entrypoint: string; prerender?: boolean }): void;
	updateConfig(config: { vite: { plugins: unknown[] } }): void;
}

export interface EventsAstroIntegration {
	name: string;
	hooks: { "astro:config:setup": (args: SetupArgs) => void };
}

/**
 * Astro integration: injects `POST /_events/checkout` (the no-JS checkout), `POST /_events/promo`
 * (the widget's promo code button; Events Pro codes), `POST /_events/waitlist` (the widget's
 * "Join the waitlist" form, T081), the `/booking` page
 * (also the waiver return page), `/_events/sign` (door signing, EV-FR-12) and `/_events/check-in` (the
 * staff check-in screen; it checks people in through Events Pro's `checkin/code` route, T082) and `/_events/opt-out` (stops Events
 * Pro's reminder and update emails for one booking and address, T083), all with
 * `Referrer-Policy: no-referrer`. Add it to `integrations` beside `emdash()`.
 */
export function eventsIntegration(options: EventsIntegrationOptions = {}): EventsAstroIntegration {
	const pluginId = options.pluginId ?? EVENTS_PLUGIN_ID;
	const config = [
		`export const pluginId = ${JSON.stringify(pluginId)};`,
		`export const esignPluginId = ${JSON.stringify(options.esignPluginId ?? null)};`,
		options.reconcile
			? `export { reconcileBooking as reconcile } from ${JSON.stringify(options.reconcile)};`
			: "export const reconcile = null;",
	].join("\n");
	return {
		name: "semics-events",
		hooks: {
			"astro:config:setup": ({ injectRoute, updateConfig }) => {
				injectRoute({
					pattern: "/_events/checkout",
					entrypoint: "@semics-tech/emdash-events/astro/checkout-endpoint",
					prerender: false,
				});
				injectRoute({
					pattern: "/_events/promo",
					entrypoint: "@semics-tech/emdash-events/astro/promo-endpoint",
					prerender: false,
				});
				injectRoute({
					pattern: "/_events/waitlist",
					entrypoint: "@semics-tech/emdash-events/astro/waitlist-endpoint",
					prerender: false,
				});
				injectRoute({
					pattern: "/booking",
					entrypoint: "@semics-tech/emdash-events/astro/BookingPage.astro",
					prerender: false,
				});
				injectRoute({
					pattern: "/_events/sign",
					entrypoint: "@semics-tech/emdash-events/astro/DoorSignPage.astro",
					prerender: false,
				});
				injectRoute({
					pattern: "/_events/check-in",
					entrypoint: "@semics-tech/emdash-events/astro/CheckIn.astro",
					prerender: false,
				});
				injectRoute({
					pattern: "/_events/opt-out",
					entrypoint: "@semics-tech/emdash-events/astro/OptOutPage.astro",
					prerender: false,
				});
				updateConfig({
					vite: {
						plugins: [
							{
								name: "semics-events-config",
								resolveId: (id: string) => (id === VIRTUAL ? RESOLVED : undefined),
								load: (id: string) => (id === RESOLVED ? config : undefined),
							},
						],
					},
				});
			},
		},
	};
}

export default eventsIntegration;
