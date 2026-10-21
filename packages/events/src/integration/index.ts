import { EVENTS_PLUGIN_ID } from "../astro/lib/call.ts";

export interface EventsIntegrationOptions {
	/**
	 * The sandboxed core's plugin id. Defaults to the slug (`semics-events`, npm installs).
	 * Registry installs get an `r_…` id: pass it here.
	 */
	pluginId?: string;
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
 * Astro integration: injects `POST /_events/checkout` (the no-JS checkout) and the `/booking`
 * page (`Referrer-Policy: no-referrer`). Add it to `integrations` beside `emdash()`.
 */
export function eventsIntegration(options: EventsIntegrationOptions = {}): EventsAstroIntegration {
	const pluginId = options.pluginId ?? EVENTS_PLUGIN_ID;
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
					pattern: "/booking",
					entrypoint: "@semics-tech/emdash-events/astro/BookingPage.astro",
					prerender: false,
				});
				updateConfig({
					vite: {
						plugins: [
							{
								name: "semics-events-config",
								resolveId: (id: string) => (id === VIRTUAL ? RESOLVED : undefined),
								load: (id: string) =>
									id === RESOLVED ? `export const pluginId = ${JSON.stringify(pluginId)};` : undefined,
							},
						],
					},
				});
			},
		},
	};
}

export default eventsIntegration;
