import { ESIGN_PLUGIN_ID } from "../astro/lib/call.ts";

export interface EsignIntegrationOptions {
	/**
	 * The sandboxed core's plugin id. Defaults to the slug (`semics-esign`, npm installs).
	 * Registry installs get an `r_…` id: pass it here.
	 */
	pluginId?: string;
}

const VIRTUAL = "virtual:semics-esign/config";
const RESOLVED = `\0${VIRTUAL}`;

/** The slice of Astro's integration API this needs (so the package takes no `astro` dependency). */
interface SetupArgs {
	injectRoute(route: { pattern: string; entrypoint: string; prerender?: boolean }): void;
	updateConfig(config: { vite: { plugins: unknown[] } }): void;
}

export interface EsignAstroIntegration {
	name: string;
	hooks: { "astro:config:setup": (args: SetupArgs) => void };
}

/**
 * Astro integration: injects the signing page `/sign/[token]`, the signed-copy page `/signed/[token]` and `/verify`, all
 * server-rendered with `Referrer-Policy: no-referrer`. Add it to `integrations` beside `emdash()`.
 */
export function esignIntegration(options: EsignIntegrationOptions = {}): EsignAstroIntegration {
	const pluginId = options.pluginId ?? ESIGN_PLUGIN_ID;
	return {
		name: "semics-esign",
		hooks: {
			"astro:config:setup": ({ injectRoute, updateConfig }) => {
				injectRoute({
					pattern: "/sign/[token]",
					entrypoint: "@semics-tech/emdash-esign/astro/SignPage.astro",
					prerender: false,
				});
				injectRoute({
					pattern: "/signed/[token]",
					entrypoint: "@semics-tech/emdash-esign/astro/SignedCopyPage.astro",
					prerender: false,
				});
				injectRoute({
					pattern: "/_esign/start",
					entrypoint: "@semics-tech/emdash-esign/astro/self-serve-endpoint",
					prerender: false,
				});
				injectRoute({
					pattern: "/verify",
					entrypoint: "@semics-tech/emdash-esign/astro/VerifyPage.astro",
					prerender: false,
				});
				updateConfig({
					vite: {
						plugins: [
							{
								name: "semics-esign-config",
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

export default esignIntegration;
