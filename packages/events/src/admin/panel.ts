import {
	actions,
	type Block,
	banner,
	button,
	column,
	context,
	type FormField,
	form,
	fromMinor,
	header,
	isValidTimeZone,
	link,
	notices,
	numberInput,
	repeater,
	select,
	stats,
	table,
	textInput,
	toggle,
	utcToZoned,
	zonedToUtc,
} from "@semics-tech/shared";

import { isObj, MAX_OCCURRENCES, MAX_TICKET_TYPES } from "../domain/config";
import { readEntryInfo } from "../domain/event-info";
import { readSettings } from "../domain/settings";
import { type ConfigStorage, type EventState, loadEventState, saveConfig } from "../routes/config";
import type { EventConfigDoc, OccurrenceDoc, TicketTypeDoc } from "../storage/schema";
import { NOTHING_TO_SAVE, SAVED, saveRefused } from "./messages";
import { EVENT_STATUS_OPTIONS, held, OCCURRENCE_STATUS_OPTIONS, priceEdit, respond, soldMeter, str } from "./ui";

/**
 * The "Tickets & booking" panel on a saved event entry (EV-US-1, T043), built only with the shared
 * Block Kit builders. The host attaches the entry's identity (`routeCtx.ui.entry.id`); the panel
 * edits the event's booking config through `saveConfig`, the same code as `config/save`.
 *
 * Existing ticket types and dates are flat fields keyed by id (`tt_price:<id>`, `oc_start:<id>`, ...)
 * so a removed or edited row can never be matched to the wrong document; new ones come from two
 * repeaters. Only changed items differ from the stored documents, so `saveConfig` writes only those
 * (one guarded call each). Budget: a load is 3 bridge calls; a save is at most 8 (`saveConfig`
 * refuses a bigger one as `TOO_MANY_CHANGES`) and renders what it wrote without reading it back.
 * `catalog` and `info` on the config are managed: they are never diffed or submitted.
 *
 * Required waivers (EV-FR-12) are Pro. The Free edition has no `waivers` seam, so the waiver
 * setting is shown as unavailable with a banner and a submitted value is ignored (Block Kit has no
 * disabled toggle, so the toggle is left out of the form). A Pro build supplies `waivers`, which
 * decides from the settings (one `settings.list`, counted against the save budget) whether a
 * pairing string and a valid licence are in place.
 */
export interface PanelDeps {
	storage: ConfigStorage;
	settings: { list(): Promise<Array<{ key: string; value: unknown }>> };
	content: { get(collection: string, id: string): Promise<{ data: Record<string, unknown> } | null> };
	newId: () => string;
	/** Pro: whether required waivers can be set here (absent in the Free edition). */
	waivers?: WaiverCheck;
}

/**
 * Pro (T066): `templates` is the e-sign catalogue cached by the last refresh (the template field
 * becomes a select); `refresh` mints the link to the suite's catalogue page for the Refresh button.
 */
export type WaiverAvailability =
	| {
			available: true;
			templates?: ReadonlyArray<{ id: string; name: string }>;
			refresh?: () => Promise<string | null>;
	  }
	| { available: false; reason: "edition" | "pairing" | "licence" };

/** Decides waiver availability from the plugin settings, without bridge calls of its own. */
export type WaiverCheck = (settings: Record<string, unknown>) => Promise<WaiverAvailability>;

const FREE_EDITION: WaiverAvailability = { available: false, reason: "edition" };

/** Bridge calls `waiverAvailability` makes: the settings read, and Pro's read of the cached catalogue (T066). */
const waiverCalls = (deps: PanelDeps) => (deps.waivers ? 2 : 0);

async function waiverAvailability(deps: PanelDeps): Promise<WaiverAvailability> {
	if (!deps.waivers) return FREE_EDITION;
	const settings = await readSettings(deps);
	return deps.waivers(settings);
}

const WAIVER_UNAVAILABLE: Record<"edition" | "pairing" | "licence", string> = {
	edition: "Required waivers need Events Pro and the E-sign plugin.",
	pairing: "Paste the pairing string from the E-sign plugin into the Events settings to require waivers.",
	licence: "Your Events Pro licence is not valid for this site, so waivers cannot be changed.",
};

const MODE_OPTIONS = [
	{ label: "Each attendee (the buyer signs for minors)", value: "each_attendee" },
	{ label: "The buyer, once per booking", value: "buyer" },
];

function waiverBlocks(config: EventConfigDoc, waivers: WaiverAvailability): Block[] {
	if (waivers.available) return [];
	const sig = config.signature;
	const now = sig?.required ? `required (template ${sig.templateId ?? "not set"})` : "off";
	return [
		banner({
			title: "Signed waivers unavailable",
			description: WAIVER_UNAVAILABLE[waivers.reason],
			variant: "alert",
			blockId: "waiver-unavailable",
		}),
		context(`Signed waiver: ${now}.`),
	];
}

function waiverFields(config: EventConfigDoc, waivers: WaiverAvailability): FormField[] {
	if (!waivers.available) return [];
	const sig = config.signature;
	const saved = sig?.templateId ?? "";
	const templates = waivers.templates ?? [];
	// A saved template the catalogue no longer lists stays selectable, so saving never drops it silently.
	const options = [
		...templates.map((t) => ({ label: t.name, value: t.id })),
		...(saved && !templates.some((t) => t.id === saved)
			? [{ label: `${saved} (not in the catalogue)`, value: saved }]
			: []),
	];
	return [
		toggle("waiver_required", "Require a signed waiver", {
			initialValue: sig?.required === true,
			description: "Attendees sign through the E-sign plugin before the booking is confirmed.",
		}),
		templates.length > 0
			? select("waiver_template", "Waiver template (E-sign)", options, {
					initialValue: saved || (options[0]?.value ?? ""),
				})
			: textInput("waiver_template", "Waiver template id (E-sign)", { initialValue: saved }),
		select("waiver_mode", "Who signs", MODE_OPTIONS, { initialValue: sig?.mode ?? "each_attendee" }),
	];
}

export type PanelInteraction =
	| { type: "panel_load" }
	| { type: "block_action"; action_id: string; block_id?: string; value?: unknown }
	| { type: "form_submit"; action_id: string; block_id?: string; values: Record<string, unknown> };

export interface PanelResponse {
	blocks: Block[];
}

type Obj = Record<string, unknown>;
type Item<T> = { id: string; data: T };

/** A whole number from a number or a numeric string; NaN otherwise (the validator then refuses it). */
const num = (v: unknown): number =>
	typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
const given = (v: unknown) => v !== undefined && v !== null && v !== "";

const pad = (n: number) => String(n).padStart(2, "0");

/** The event's zone, from the copy of its entry's info; UTC when it has none. */
const zoneOf = (config: EventConfigDoc): string => {
	const zone = config.info?.timezone;
	return zone && isValidTimeZone(zone) ? zone : "UTC";
};

/** `2026-12-01 19:30` in the zone. */
function localText(iso: string, zone: string): string {
	const p = utcToZoned(Date.parse(iso), zone);
	return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})$/;

/**
 * A typed date to an ISO instant: `2026-12-01 19:30` is wall-clock time in the event's zone; anything
 * else (a full ISO string with an offset, or garbage) goes to the validator unchanged.
 */
function toInstant(text: string, zone: string): string {
	const m = LOCAL.exec(text);
	if (!m) return text;
	const [year, month, day, hour, minute] = m.slice(1).map(Number) as [number, number, number, number, number];
	if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return text;
	const ms = zonedToUtc({ year, month, day, hour, minute }, zone);
	const back = utcToZoned(ms, zone);
	// Feb 30 and friends roll over; refuse them rather than saving another day.
	if (back.day !== day || back.month !== month) return text;
	return new Date(ms).toISOString();
}

const rows = (value: unknown): Obj[] => (Array.isArray(value) ? value.filter(isObj) : []);
const blankRow = (row: Obj) => Object.values(row).every((v) => !given(v) || (typeof v === "string" && v.trim() === ""));

// --- render -----------------------------------------------------------------------------------

function statsBlocks(config: EventConfigDoc): Block[] {
	return [
		stats([
			{ label: "Sold", value: String(config.sold) },
			{ label: "Held", value: String(held(config)) },
			{ label: "Remaining", value: String(Math.max(config.capacity - config.reserved, 0)) },
			{ label: "Capacity", value: String(config.capacity) },
		]),
		soldMeter("Seats sold", config),
	];
}

const byTicketOrder = (a: Item<TicketTypeDoc>, b: Item<TicketTypeDoc>) =>
	a.data.sort - b.data.sort || (a.data.name < b.data.name ? -1 : a.data.name > b.data.name ? 1 : 0);

function liveTables(config: EventConfigDoc, tickets: Item<TicketTypeDoc>[], dates: Item<OccurrenceDoc>[]): Block[] {
	const zone = zoneOf(config);
	const out: Block[] = [];
	if (tickets.length > 0) {
		out.push(
			table({
				columns: [
					column("name", "Ticket type"),
					column("price", "Price"),
					column("sold", "Sold", "number"),
					column("held", "Held", "number"),
					column("capacity", "Capacity", "number"),
				],
				rows: tickets.map(({ data: t }) => ({
					name: t.name,
					price: fromMinor(t.priceMinor, config.currency),
					sold: t.sold,
					held: held(t),
					capacity: t.capacity,
				})),
				pageActionId: "panel.tickets.page",
			}),
		);
	}
	if (dates.length > 0) {
		out.push(
			table({
				columns: [
					column("starts", `Date (${zone})`),
					column("status", "Status", "badge"),
					column("sold", "Sold", "number"),
					column("held", "Held", "number"),
					column("capacity", "Capacity", "number"),
				],
				rows: dates.map(({ data: o }) => ({
					starts: localText(o.startsAt, zone),
					status: o.status,
					sold: o.sold,
					held: held(o),
					capacity: o.capacity,
				})),
				pageActionId: "panel.dates.page",
			}),
		);
	}
	return out;
}

function panelForm(state: EventState, extra: Block[], waivers: WaiverAvailability): PanelResponse {
	const config = state.config as EventConfigDoc;
	const zone = zoneOf(config);
	const tickets = (state.ticketTypes as Item<TicketTypeDoc>[]).slice().sort(byTicketOrder);
	const dates = state.occurrences as Item<OccurrenceDoc>[];

	const fields = [
		select("status", "Sales status", EVENT_STATUS_OPTIONS, { initialValue: config.status }),
		numberInput("capacity", "Event capacity", { initialValue: config.capacity, min: 1 }),
		toggle("waitlist", "Waitlist when sold out", { initialValue: config.waitlistEnabled }),
		textInput("recurrence", "Repeats (RRULE)", {
			initialValue: config.recurrence ?? "",
			placeholder: "FREQ=WEEKLY;BYDAY=MO;COUNT=10;EXDATE=20261228",
		}),
		...waiverFields(config, waivers),
		...tickets.flatMap(({ id, data: t }) => [
			textInput(`tt_name:${id}`, `${t.name}: name`, { initialValue: t.name }),
			textInput(`tt_price:${id}`, `${t.name}: price (${config.currency})`, {
				initialValue: fromMinor(t.priceMinor, config.currency),
			}),
			numberInput(`tt_capacity:${id}`, `${t.name}: capacity`, { initialValue: t.capacity, min: 1 }),
			toggle(`tt_remove:${id}`, `Remove ${t.name}`, { description: "Not possible once seats are held or sold." }),
		]),
		...(tickets.length < MAX_TICKET_TYPES
			? [
					repeater(
						"newTickets",
						"New ticket types",
						[
							textInput("name", "Name"),
							textInput("price", `Price (${config.currency})`, { placeholder: "0.00" }),
							numberInput("capacity", "Capacity", { min: 1 }),
						],
						{ itemLabel: "Ticket type", maxItems: MAX_TICKET_TYPES - tickets.length },
					),
				]
			: []),
		...dates.flatMap(({ id, data: o }) => {
			const when = localText(o.startsAt, zone);
			return [
				textInput(`oc_start:${id}`, `${when}: starts (${zone})`, { initialValue: when }),
				numberInput(`oc_capacity:${id}`, `${when}: capacity`, { initialValue: o.capacity, min: 1 }),
				select(`oc_status:${id}`, `${when}: status`, OCCURRENCE_STATUS_OPTIONS, { initialValue: o.status }),
				toggle(`oc_remove:${id}`, `Remove ${when}`, { description: "Not possible once seats are held or sold." }),
			];
		}),
		...(dates.length < MAX_OCCURRENCES
			? [
					repeater(
						"newDates",
						"New dates",
						[
							textInput("startsAt", `Starts (${zone})`, { placeholder: "2026-12-01 19:30" }),
							numberInput("capacity", "Capacity", { min: 1 }),
						],
						{ itemLabel: "Date", maxItems: MAX_OCCURRENCES - dates.length },
					),
				]
			: []),
		// The Block Kit types leave repeaters out of FormField, but the host accepts them in a form.
	] as FormField[];

	return respond([
		header("Tickets & booking"),
		...extra,
		...waiverBlocks(config, waivers),
		...(waivers.available && waivers.refresh
			? [actions([button("panel.templates.refresh", "Refresh templates")], { blockId: "waiver-templates" })]
			: []),
		...statsBlocks(config),
		...liveTables(config, tickets, dates),
		context(
			`Dates are in ${zone}; a rule adds dates from the event start, 60 days ahead. Only the items you change are written. Capacity cannot go below the seats already held or sold.`,
		),
		form({ fields, submit: { label: "Save changes", actionId: "panel.save" }, blockId: "tickets" }),
	]);
}

async function enableForm(deps: PanelDeps, extra: Block[] = []): Promise<PanelResponse> {
	const currency = str((await deps.settings.list()).find((s) => s.key === "currency")?.value, 3).toUpperCase() || "GBP";
	return respond([
		header("Tickets & booking"),
		...extra,
		context(
			"This event has no booking settings yet. Enable them to sell tickets; sales stay in draft until you open them.",
		),
		form({
			fields: [
				numberInput("capacity", "Event capacity", { initialValue: 100, min: 1 }),
				textInput("currency", "Currency (ISO code)", { initialValue: currency }),
			],
			submit: { label: "Enable booking", actionId: "panel.enable" },
			blockId: "tickets-enable",
		}),
	]);
}

// --- save -------------------------------------------------------------------------------------

type SaveOutcome = { ok: true; state: EventState } | { ok: false; issues: Array<{ path: string; code: string }> };

async function runSave(
	deps: PanelDeps,
	eventId: string,
	input: Obj,
	state: EventState,
	reservedCalls = 0,
): Promise<SaveOutcome> {
	let saved: EventState | undefined;
	const out = (await saveConfig(
		deps.storage,
		{ eventId, ...input },
		deps.newId,
		state,
		() => readEntryInfo({ settings: deps.settings, content: deps.content }, eventId),
		(s) => {
			saved = s;
		},
		reservedCalls,
	)) as { ok?: boolean; issues?: Array<{ path: string; code: string }> };
	if (out.ok && saved) return { ok: true, state: saved };
	return { ok: false, issues: out.issues ?? [] };
}

async function savePanel(deps: PanelDeps, eventId: string, values: Obj): Promise<PanelResponse> {
	const state = await loadEventState(eventId, deps.storage);
	const stored = state.config;
	if (!stored) return enableForm(deps);
	const { catalog: _catalog, info: _info, ...base } = stored;
	const zone = zoneOf(stored);
	const waivers = await waiverAvailability(deps);

	let changed = 0;
	const status = str(values.status) || stored.status;
	if (status !== stored.status) changed++;
	const capacity = given(values.capacity) ? num(values.capacity) : stored.capacity;
	if (capacity !== stored.capacity) changed++;
	const waitlistEnabled = typeof values.waitlist === "boolean" ? values.waitlist : stored.waitlistEnabled;
	const recurrence = values.recurrence === undefined ? (stored.recurrence ?? "") : str(values.recurrence, 500);
	if (recurrence !== (stored.recurrence ?? "")) changed++;
	if (waitlistEnabled !== stored.waitlistEnabled) changed++;
	const storedSignature = stored.signature ?? { required: false, mode: "each_attendee" };
	let signature = storedSignature;
	if (waivers.available) {
		const required = typeof values.waiver_required === "boolean" ? values.waiver_required : storedSignature.required;
		const templateId =
			values.waiver_template !== undefined ? str(values.waiver_template, 64) : (storedSignature.templateId ?? "");
		const mode =
			values.waiver_mode === "buyer" || values.waiver_mode === "each_attendee"
				? values.waiver_mode
				: storedSignature.mode;
		if (required && !/^[A-Za-z0-9_-]{1,64}$/.test(templateId)) {
			return panelForm(state, saveRefused([{ path: "", code: "WAIVER_TEMPLATE_REQUIRED" }]), waivers);
		}
		signature = { required, mode, ...(templateId ? { templateId } : {}) };
		if (JSON.stringify(signature) !== JSON.stringify(storedSignature)) changed++;
	}

	const ticketTypes: Obj[] = [];
	let nextSort = 0;
	for (const { id, data } of (state.ticketTypes as Item<TicketTypeDoc>[]).slice().sort(byTicketOrder)) {
		nextSort = Math.max(nextSort, data.sort + 1);
		if (values[`tt_remove:${id}`] === true) {
			changed++;
			continue;
		}
		const item: Obj = { ...data, id };
		const name = str(values[`tt_name:${id}`], 120);
		if (name !== "" && name !== data.name) {
			item.name = name;
			changed++;
		}
		const cap = values[`tt_capacity:${id}`];
		if (given(cap) && num(cap) !== data.capacity) {
			item.capacity = num(cap);
			changed++;
		}
		const edit = priceEdit(values[`tt_price:${id}`], data.priceMinor, stored.currency);
		if (edit) {
			delete item.priceMinor;
			item.price = edit.price;
			changed++;
		}
		ticketTypes.push(item);
	}
	for (const row of rows(values.newTickets)) {
		if (blankRow(row)) continue;
		changed++;
		ticketTypes.push({
			name: str(row.name, 120),
			price: str(row.price, 20) || "0",
			capacity: given(row.capacity) ? num(row.capacity) : capacity,
			sort: nextSort++,
		});
	}

	const occurrences: Obj[] = [];
	for (const { id, data } of state.occurrences as Item<OccurrenceDoc>[]) {
		if (values[`oc_remove:${id}`] === true) {
			changed++;
			continue;
		}
		const item: Obj = { ...data, id };
		const typed = str(values[`oc_start:${id}`], 40);
		if (typed !== "" && typed !== localText(data.startsAt, zone)) {
			const startsAt = toInstant(typed, zone);
			item.startsAt = startsAt;
			// Keep the length of the date: move the end with the start.
			const moved = Date.parse(startsAt) - Date.parse(data.startsAt);
			if (data.endsAt && Number.isFinite(moved)) item.endsAt = new Date(Date.parse(data.endsAt) + moved).toISOString();
			changed++;
		}
		const cap = values[`oc_capacity:${id}`];
		if (given(cap) && num(cap) !== data.capacity) {
			item.capacity = num(cap);
			changed++;
		}
		const next = str(values[`oc_status:${id}`]);
		if (next !== "" && next !== data.status) {
			item.status = next;
			changed++;
		}
		occurrences.push(item);
	}
	for (const row of rows(values.newDates)) {
		if (blankRow(row)) continue;
		changed++;
		occurrences.push({
			startsAt: toInstant(str(row.startsAt, 40), zone),
			capacity: given(row.capacity) ? num(row.capacity) : capacity,
		});
	}

	if (changed === 0) {
		return panelForm(state, NOTHING_TO_SAVE(), waivers);
	}
	const result = await runSave(
		deps,
		eventId,
		{ config: { ...base, status, capacity, waitlistEnabled, signature, recurrence }, ticketTypes, occurrences },
		state,
		waiverCalls(deps),
	);
	return result.ok ? panelForm(result.state, SAVED(), waivers) : panelForm(state, saveRefused(result.issues), waivers);
}

async function enablePanel(deps: PanelDeps, eventId: string, values: Obj): Promise<PanelResponse> {
	const state = await loadEventState(eventId, deps.storage);
	if (state.config) return panelForm(state, [], await waiverAvailability(deps));
	const currency = str(values.currency, 3).toUpperCase();
	const result = await runSave(
		deps,
		eventId,
		{ config: { status: "draft", capacity: num(values.capacity), currency }, ticketTypes: [], occurrences: [] },
		state,
		waiverCalls(deps),
	);
	return result.ok
		? panelForm(result.state, SAVED("Booking is enabled for this event."), await waiverAvailability(deps))
		: enableForm(deps, saveRefused(result.issues));
}

// --- dispatch ---------------------------------------------------------------------------------

export async function handlePanel(
	deps: PanelDeps,
	interaction: PanelInteraction,
	eventId: string,
): Promise<PanelResponse> {
	if (!eventId) return respond(notices([{ severity: "error", title: "Save the entry first" }]));
	if (interaction.type === "form_submit") {
		if (interaction.action_id === "panel.save") return savePanel(deps, eventId, interaction.values);
		if (interaction.action_id === "panel.enable") return enablePanel(deps, eventId, interaction.values);
	}
	const state = await loadEventState(eventId, deps.storage);
	if (!state.config) return enableForm(deps);
	const waivers = await waiverAvailability(deps);
	let extra: Block[] = [];
	if (interaction.type === "block_action" && interaction.action_id === "panel.templates.refresh" && waivers.available) {
		// The core cannot reach E-sign, so the link takes the admin to the suite page that fetches the catalogue.
		const url = await waivers.refresh?.();
		extra = url
			? [
					actions([link("Fetch the templates from E-sign", { kind: "external", url }, { appearance: "primary" })]),
					context("The link works for five minutes. Reload this panel afterwards to pick a template."),
				]
			: notices([
					{
						severity: "warning",
						title: "Could not prepare the refresh",
						message: "Check the E-sign pairing string in the Events settings.",
					},
				]);
	}
	return panelForm(state, extra, waivers);
}
