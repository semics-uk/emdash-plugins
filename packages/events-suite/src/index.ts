import esignCore from "@semics-tech/emdash-esign";
import { esignIntegration } from "@semics-tech/emdash-esign/integration";
import { esignUi } from "@semics-tech/emdash-esign/ui";
import eventsCore from "@semics-tech/emdash-events";
import { eventsIntegration } from "@semics-tech/emdash-events/integration";
import { eventsUi } from "@semics-tech/emdash-events/ui";
import type { PluginDescriptor } from "emdash";

/**
 * A core the suite links: a sandboxed descriptor to load from npm (the product package's default
 * export, or a Pro build of the same slug), or `{ pluginId }` for a core installed from the
 * registry, whose id is an `r_…` value the operator copies from the admin.
 */
export type SuiteCore = PluginDescriptor | { pluginId: string };

export interface EventsSuiteOptions {
	/** Default: the Free Events core of `@semics-tech/emdash-events`. */
	events?: SuiteCore;
	/** Default: the Free E-sign core of `@semics-tech/emdash-esign`. */
	esign?: SuiteCore;
}

/** The slice of Astro's integration API the injected pages need (no `astro` dependency). */
interface SetupArgs {
	injectRoute(route: { pattern: string; entrypoint: string; prerender?: boolean }): void;
	updateConfig(config: { vite: { plugins: unknown[] } }): void;
}

export interface SuiteAstroIntegration {
	name: string;
	hooks: { "astro:config:setup": (args: SetupArgs) => void };
}

export interface EventsSuite {
	/** Spread into `emdash({ sandboxed })`: the cores loaded from npm (none for registry installs). */
	sandboxed: PluginDescriptor[];
	/** Spread into `emdash({ plugins })`: both native UI descriptors. */
	plugins: PluginDescriptor[];
	/** Spread into Astro's `integrations`: both products' pages and the suite's waiver page. */
	integrations: SuiteAstroIntegration[];
	/** The id each core runs under on this site. */
	pluginIds: { events: string; esign: string };
}

/** A plugin id is a route segment (`/_emdash/api/plugins/<id>/…`): a slug or a registry `r_…` id. */
const PLUGIN_ID = /^[A-Za-z0-9_-]{1,128}$/;

function resolveCore(core: SuiteCore): { id: string; descriptor?: PluginDescriptor } {
	const descriptor = "id" in core ? core : undefined;
	const id = descriptor ? descriptor.id : (core as { pluginId: string }).pluginId;
	if (typeof id !== "string" || !PLUGIN_ID.test(id)) {
		throw new Error(`eventsSuite: invalid plugin id ${JSON.stringify(id)} (letters, digits, "_" and "-" only)`);
	}
	return descriptor ? { id, descriptor } : { id };
}

const VIRTUAL = "virtual:semics-events-suite/config";
const RESOLVED = `\0${VIRTUAL}`;
/** The suite's own page: the inline signing step of <BookingWithWaiver>. */
export const WAIVER_ROUTE = "/_events/waiver";
/** The suite's catalogue page: where the Events panel's Refresh templates link lands (T066). */
export const TEMPLATES_ROUTE = "/_events/templates";
/** What Events' booking page runs for a booking waiting for signatures (T066). */
const RECONCILE_MODULE = "@semics-tech/emdash-events-suite/astro/lib/reconcile";

/**
 * Injects `/_events/waiver` (the booking and signing steps of `<BookingWithWaiver>`) and gives it,
 * through a virtual module, the id of each core. `eventsSuite()` adds it for you.
 */
export function suiteIntegration(ids: { eventsPluginId: string; esignPluginId: string }): SuiteAstroIntegration {
	const config = [
		`export const eventsPluginId = ${JSON.stringify(ids.eventsPluginId)};`,
		`export const esignPluginId = ${JSON.stringify(ids.esignPluginId)};`,
	].join("\n");
	return {
		name: "semics-events-suite",
		hooks: {
			"astro:config:setup": ({ injectRoute, updateConfig }) => {
				injectRoute({
					pattern: WAIVER_ROUTE,
					entrypoint: "@semics-tech/emdash-events-suite/astro/WaiverPage.astro",
					prerender: false,
				});
				injectRoute({
					pattern: TEMPLATES_ROUTE,
					entrypoint: "@semics-tech/emdash-events-suite/astro/TemplatesPage.astro",
					prerender: false,
				});
				updateConfig({
					vite: {
						plugins: [
							{
								name: "semics-events-suite-config",
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

/**
 * Events and E-sign on one site (SX-FR-01). Every part is told the id of each core it calls, taken
 * from the descriptor or the registry id given here, never assumed:
 *
 * ```js
 * const suite = eventsSuite(); // or eventsSuite({ events: eventsPro(), esign: { pluginId: "r_…" } })
 * export default defineConfig({
 *   integrations: [...suite.integrations, emdash({ sandboxed: suite.sandboxed, plugins: suite.plugins })],
 * });
 * ```
 */
export function eventsSuite(options: EventsSuiteOptions = {}): EventsSuite {
	const events = resolveCore(options.events ?? eventsCore);
	const esign = resolveCore(options.esign ?? esignCore);
	return {
		sandboxed: [events.descriptor, esign.descriptor].filter((d): d is PluginDescriptor => d !== undefined),
		plugins: [eventsUi(), esignUi()],
		integrations: [
			eventsIntegration({ pluginId: events.id, esignPluginId: esign.id, reconcile: RECONCILE_MODULE }),
			esignIntegration({ pluginId: esign.id }),
			suiteIntegration({ eventsPluginId: events.id, esignPluginId: esign.id }),
		],
		pluginIds: { events: events.id, esign: esign.id },
	};
}

export default eventsSuite;
