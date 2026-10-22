// Provided by the integration's Vite plugin (`eventsIntegration({ pluginId })`).
declare module "virtual:semics-events/config" {
	export const pluginId: string;
	/** The e-sign core's plugin id, or `null` when e-sign is not configured (`eventsIntegration({ esignPluginId })`). */
	export const esignPluginId: string | null;
}
