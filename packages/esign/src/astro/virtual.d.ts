// Provided by the integration's Vite plugin (`esignIntegration({ pluginId })`).
declare module "virtual:semics-esign/config" {
	export const pluginId: string;
	/** `esignIntegration({ page })`, checked (T169). */
	export const page: import("./lib/page").EsignPageOptions;
}

// Vite's `?raw` imports: the file's text, untransformed.
declare module "*?raw" {
	const text: string;
	export default text;
}
