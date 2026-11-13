import esignCore from "@semics-tech/emdash-esign";
import { esignIntegration } from "@semics-tech/emdash-esign/integration";
import { esignUi } from "@semics-tech/emdash-esign/ui";
import eventsCore from "@semics-tech/emdash-events";
import { eventsIntegration, type PageOptions } from "@semics-tech/emdash-events/integration";
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
	/** How `/booking` and `/_events/waiver` look on this site: theme, stylesheet, brand, event page path. */
	page?: PageOptions;
	/**
	 * Gift vouchers (T166): the Vouchers Pro core (its descriptor, or `{ pluginId }`). Optional; without it a
	 * site is wired exactly as before. With it the booking forms hold a "Gift voucher code" with Vouchers and the
	 * site gets one Stripe webhook endpoint, `/_semics/stripe`, for both Events and Vouchers. T168: also
	 * `<BuyVoucher>` (posting to `/_vouchers/buy`), the voucher page `/_vouchers/v`, Stripe's return page
	 * `/_vouchers/thanks` and `/_vouchers/setup` (activity vouchers picked from Events, at Events' prices).
	 */
	vouchers?: SuiteCore;
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
	/** The id each core runs under on this site (`vouchers` only when configured). */
	pluginIds: { events: string; esign: string; vouchers?: string };
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
/** The suite's pairing page: pairs Events with E-sign on this site in one click (T145). */
export const PAIR_ROUTE = "/_events/pair";
/** What Events' booking page runs for a booking waiting for signatures (T066). */
const RECONCILE_MODULE = "@semics-tech/emdash-events-suite/astro/lib/reconcile";
/** The site's one Stripe webhook endpoint, routing by the session's `metadata.plugin` (T163 §4a, T166). */
export const STRIPE_ROUTE = "/_semics/stripe";
/** The gift voucher pages (T168): buying, the voucher itself, Stripe's return page and activity setup. */
export const VOUCHER_PAGES: ReadonlyArray<readonly [string, string]> = [
	["/_vouchers/buy", "buy-endpoint"],
	["/_vouchers/v", "VoucherPage.astro"],
	["/_vouchers/thanks", "VoucherThanks.astro"],
	["/_vouchers/setup", "VouchersSetupPage.astro"],
];
/** What Events' checkout runs to hold a gift voucher (T166). */
const VOUCHER_MODULE = "@semics-tech/emdash-events-suite/astro/lib/voucher";

/**
 * Injects `/_events/waiver` (the booking and signing steps of `<BookingWithWaiver>`) and gives it,
 * through a virtual module, the id of each core. `eventsSuite()` adds it for you.
 */
export function suiteIntegration(
	ids: { eventsPluginId: string; esignPluginId: string; vouchersPluginId?: string },
	page: PageOptions = {},
): SuiteAstroIntegration {
	const config = [
		`export const eventsPluginId = ${JSON.stringify(ids.eventsPluginId)};`,
		`export const esignPluginId = ${JSON.stringify(ids.esignPluginId)};`,
		`export const page = ${JSON.stringify(page)};`,
		...(ids.vouchersPluginId ? [`export const vouchersPluginId = ${JSON.stringify(ids.vouchersPluginId)};`] : []),
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
				injectRoute({
					pattern: PAIR_ROUTE,
					entrypoint: "@semics-tech/emdash-events-suite/astro/PairPage.astro",
					prerender: false,
				});
				if (ids.vouchersPluginId) {
					injectRoute({
						pattern: STRIPE_ROUTE,
						entrypoint: "@semics-tech/emdash-events-suite/astro/stripe-endpoint",
						prerender: false,
					});
					// T168: buying (<BuyVoucher> posts here), the voucher page, Stripe's return page, activity setup.
					for (const [pattern, entry] of VOUCHER_PAGES) {
						injectRoute({ pattern, entrypoint: `@semics-tech/emdash-events-suite/astro/${entry}`, prerender: false });
					}
				}
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
	const vouchers = options.vouchers ? resolveCore(options.vouchers) : undefined;
	const voucherIds = vouchers ? { vouchersPluginId: vouchers.id } : {};
	return {
		sandboxed: [events.descriptor, esign.descriptor, vouchers?.descriptor].filter(
			(d): d is PluginDescriptor => d !== undefined,
		),
		plugins: [eventsUi(), esignUi()],
		integrations: [
			eventsIntegration({
				pluginId: events.id,
				esignPluginId: esign.id,
				reconcile: RECONCILE_MODULE,
				...(options.page ? { page: options.page } : {}),
				...(vouchers ? { vouchers: { pluginId: vouchers.id, module: VOUCHER_MODULE } } : {}),
			}),
			esignIntegration({ pluginId: esign.id }),
			suiteIntegration({ eventsPluginId: events.id, esignPluginId: esign.id, ...voucherIds }, options.page),
		],
		pluginIds: { events: events.id, esign: esign.id, ...(vouchers ? { vouchers: vouchers.id } : {}) },
	};
}

export default eventsSuite;
