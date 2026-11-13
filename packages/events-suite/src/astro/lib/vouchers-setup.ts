/**
 * Activity vouchers picked from Events' catalogue, with Events' prices (T168, T163 §3, from T166), behind
 * `/_vouchers/setup`.
 *
 * Vouchers cannot read Events (R16), and a price sent by a buyer's browser could not be trusted, so the price an
 * activity voucher is sold at lives in Vouchers' `activityTypes` setting (`eventId, ticketTypeId, priceMinor,
 * label` per line). This page fills it from Events: as the signed-in administrator, it reads Events'
 * `public/events` and each event's `public/event` (ticket types and prices) in process, and writes the chosen
 * lines with Events' current prices through the host's own settings handler, which checks `plugins:manage`.
 * Saving again copies new prices. Lines for events Events no longer lists are kept as they are. Glue only.
 */
import { callPublicRoute } from "@semics-tech/emdash-events/astro/lib/call";
import type { SettingsHandlers } from "./pair";

export const SETUP_PATH = "/_vouchers/setup";
const SETTING = "activityTypes";
/** Events read at most (one `public/event` each, in parallel). */
const MAX_EVENTS = 20;

export interface SetupIds {
	eventsPluginId: string;
	vouchersPluginId: string;
}

export interface SetupContext {
	locals: unknown;
	url: URL;
	settings: SettingsHandlers;
}

export interface SetupChoice {
	/** `eventId/ticketTypeId`, the checkbox value. */
	value: string;
	label: string;
	eventTitle: string;
	ticketName: string;
	/** Events' price now. */
	priceMinor: number;
	chosen: boolean;
	/** What Vouchers sells it at now, when chosen. */
	storedPriceMinor?: number;
}

/** The page's state; `currency`, `choices` and `kept` are there when `ready`. */
export interface SetupView {
	state: "forbidden" | "error" | "ready";
	code?: string;
	currency?: string;
	choices?: SetupChoice[];
	kept?: string[];
}

interface Line {
	eventId: string;
	ticketTypeId: string;
	priceMinor: number;
	label: string;
	raw: string;
}

function parseLines(text: unknown): Line[] {
	if (typeof text !== "string") return [];
	return text
		.split(/\r?\n/)
		.map((raw) => raw.trim())
		.filter(Boolean)
		.flatMap((raw) => {
			const parts = raw.split(",");
			if (parts.length < 4) return [];
			const [eventId = "", ticketTypeId = "", price = ""] = parts.slice(0, 3).map((s) => s.trim());
			return [{ eventId, ticketTypeId, priceMinor: Number(price), label: parts.slice(3).join(",").trim(), raw }];
		});
}

/** Vouchers' settings as the administrator sees them, or null when the visitor may not manage plugins. */
async function vouchersSettings(ctx: SetupContext, ids: SetupIds): Promise<Record<string, unknown> | null> {
	const res = await ctx.settings.read(ids.vouchersPluginId).catch(() => null);
	if (!res?.ok) return null;
	const body = (await res.json().catch(() => ({}))) as { data?: { values?: Record<string, unknown> } };
	return body.data?.values ?? {};
}

interface CatalogueEntry {
	eventId: string;
	title: string;
	ticketTypes: Array<{ id: string; name: string; priceMinor: number }>;
}

/** Events' upcoming events in `currency` with their paid ticket types. */
async function catalogue(ctx: SetupContext, ids: SetupIds, currency: string): Promise<CatalogueEntry[] | null> {
	const call = { locals: ctx.locals as never, url: ctx.url };
	const post = <T>(path: string, body: unknown) =>
		callPublicRoute<T>(call, { method: "POST", path, pluginId: ids.eventsPluginId, body }).catch(() => null);
	const list = await post<{ events?: Array<{ eventId: string; title?: string; currency?: string }> }>(
		"public/events",
		{},
	);
	if (!list?.ok) return null;
	const events = (list.data.events ?? []).filter((e) => e.currency === currency).slice(0, MAX_EVENTS);
	const details = await Promise.all(
		events.map((e) =>
			post<{ title?: string; currency?: string; ticketTypes?: CatalogueEntry["ticketTypes"] }>("public/event", {
				eventId: e.eventId,
			}),
		),
	);
	return events.flatMap((e, i) => {
		const d = details[i];
		if (!d?.ok || d.data.currency !== currency) return [];
		const ticketTypes = (d.data.ticketTypes ?? []).filter(
			(t) => Number.isSafeInteger(t.priceMinor) && t.priceMinor > 0,
		);
		return [{ eventId: e.eventId, title: d.data.title ?? e.title ?? e.eventId, ticketTypes }];
	});
}

async function load(ctx: SetupContext, ids: SetupIds) {
	const values = await vouchersSettings(ctx, ids);
	if (!values) return null;
	const currency = typeof values.currency === "string" && values.currency ? values.currency : "GBP";
	const lines = parseLines(values[SETTING]);
	const events = await catalogue(ctx, ids, currency);
	return { currency, lines, events };
}

function choicesOf(events: CatalogueEntry[], lines: Line[]): SetupChoice[] {
	return events.flatMap((e) =>
		e.ticketTypes.map((t) => {
			const line = lines.find((l) => l.eventId === e.eventId && l.ticketTypeId === t.id);
			return {
				value: `${e.eventId}/${t.id}`,
				label: line?.label || `${e.title}: ${t.name}`,
				eventTitle: e.title,
				ticketName: t.name,
				priceMinor: t.priceMinor,
				chosen: !!line,
				...(line ? { storedPriceMinor: line.priceMinor } : {}),
			};
		}),
	);
}

const seen = (choices: SetupChoice[], l: Line) => choices.some((c) => c.value === `${l.eventId}/${l.ticketTypeId}`);

/** The page's GET. */
export async function setupView(ctx: SetupContext, ids: SetupIds): Promise<SetupView> {
	const loaded = await load(ctx, ids);
	if (!loaded) return { state: "forbidden" };
	if (!loaded.events) return { state: "error", code: "EVENTS_UNAVAILABLE" };
	const choices = choicesOf(loaded.events, loaded.lines);
	const kept = loaded.lines.filter((l) => !seen(choices, l)).map((l) => l.raw);
	return { state: "ready", currency: loaded.currency, choices, kept };
}

/** The page's POST: the chosen ticket types, written with Events' prices. */
export async function saveActivities(
	ctx: SetupContext,
	ids: SetupIds,
	chosen: string[],
): Promise<{ state: "saved"; count: number } | { state: "forbidden" } | { state: "error"; code: string }> {
	const loaded = await load(ctx, ids);
	if (!loaded) return { state: "forbidden" };
	if (!loaded.events) return { state: "error", code: "EVENTS_UNAVAILABLE" };
	const choices = choicesOf(loaded.events, loaded.lines);
	const picked = choices
		.filter((c) => chosen.includes(c.value))
		.map((c) => {
			const [eventId, ticketTypeId] = c.value.split("/");
			return `${eventId}, ${ticketTypeId}, ${c.priceMinor}, ${c.label.replace(/[\r\n]+/g, " ").slice(0, 120)}`;
		});
	const kept = loaded.lines.filter((l) => !seen(choices, l)).map((l) => l.raw);
	const text = [...picked, ...kept].join("\n");
	const res = await ctx.settings.write(ids.vouchersPluginId, { [SETTING]: text }).catch(() => null);
	if (!res?.ok) return { state: "error", code: "INTERNAL" };
	return { state: "saved", count: picked.length + kept.length };
}
