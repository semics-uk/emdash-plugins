import {
	actions,
	type Block,
	button,
	context,
	fieldsBlock,
	form,
	formatMoney,
	fromMinor,
	header,
	link,
	meter,
	type NoticeInput,
	notices,
	numberInput,
	select,
	table,
	textInput,
	toMinor,
} from "@semics-tech/shared";

import { encryptionKeyStatus, type SecretReadOutcome } from "../domain/encryption";
import { mappingOf } from "../domain/event-info";
import { type CollectionSchemas, type EventsMapping, validateMapping } from "../domain/mapping";
import { iso } from "../domain/time";
import { type AttendeeStorage, checkIn, EXPORT_PAGE_SIZE, undoCheckIn } from "../routes/attendees";
import { type ConfigStorage, type EventState, loadEventState, saveConfig } from "../routes/config";
import {
	type AttendeeDoc,
	type BookingDoc,
	type EventConfigDoc,
	SECRET_SETTING_KEYS,
	type TicketTypeDoc,
} from "../storage/schema";
import { NOTHING_TO_SAVE, SAVED, saveRefused } from "./messages";
import { col, EVENT_STATUS_OPTIONS, optionsOf, respond, str } from "./ui";

/**
 * Block Kit admin pages (EV-FR-11, EV-US-5, EV-US-7), built only with the shared builders.
 *
 * One `admin` route answers every interaction; `handleAdmin` dispatches on the page path or the
 * action id and returns `{ blocks }`. Every action is at most 10 bridge calls (target 8):
 * lists read one page of 50 to 100 rows, attendee lists add one `getMany` for the booking
 * statuses, a name search scans at most 4 pages, and the event editor reads the event once
 * (3 calls) and hands that state to `saveConfig` instead of reading it again.
 */
type Where = Record<string, unknown>;
type Page = { items: Array<{ id: string; data: unknown }>; hasMore?: boolean; cursor?: string };
type Query = (o: {
	where?: Where;
	orderBy?: Record<string, "asc" | "desc">;
	limit?: number;
	cursor?: string;
}) => Promise<Page>;

export type AdminStorage = AttendeeStorage &
	ConfigStorage & {
		bookings: { query: Query };
		event_configs: { query: Query };
		attendees: { query: Query };
	};

export interface AdminDeps {
	storage: AdminStorage;
	settings: { list(): Promise<Array<{ key: string; value: unknown }>> };
	schema: { listCollections(): Promise<Array<{ slug: string; fields: ReadonlyArray<{ slug: string }> }>> };
	/** `content:read`, for event titles in lists. Optional: a list without it shows ids. */
	content?: {
		list(
			collection: string,
			options?: { limit?: number },
		): Promise<{ items: Array<{ id: string; data?: Record<string, unknown> }> }>;
	};
	now: number;
	/** Site origin, for the absolute CSV download link (Block Kit external links must be absolute). */
	origin: string;
	/** Plugin id, for the CSV download link. */
	pluginId: string;
	newId: () => string;
}

export type AdminInteraction =
	| { type: "page_load"; page: string }
	| { type: "block_action"; action_id: string; page?: string; block_id?: string; value?: unknown }
	| { type: "form_submit"; action_id: string; page?: string; block_id?: string; values: Record<string, unknown> };

export interface AdminResponse {
	blocks: Block[];
}

const BOOKINGS_PAGE = 50;
const NAME_SEARCH_PAGES = 4;
const NAME_SEARCH_MATCHES = 25;
const BOOKING_STATUSES = [
	"draft",
	"held",
	"awaiting_signature",
	"awaiting_payment",
	"confirmed",
	"expired",
	"cancelled",
	"refunded",
	"refunded_unavailable",
];

// --- setup ------------------------------------------------------------------------------------

const MAPPING_DEFAULTS: EventsMapping = {
	eventsCollection: "events",
	fieldStartsAt: "starts_at",
	fieldEndsAt: "ends_at",
	fieldTimezone: "timezone",
	fieldVenue: "venue",
};

async function setupPage(deps: AdminDeps): Promise<AdminResponse> {
	const [entries, collections] = await Promise.all([deps.settings.list(), deps.schema.listCollections()]);
	const values = Object.fromEntries(entries.map((e) => [e.key, e.value]));
	const mapping = { ...MAPPING_DEFAULTS };
	for (const key of Object.keys(mapping) as Array<keyof EventsMapping>) {
		if (typeof values[key] === "string") mapping[key] = values[key] as string;
	}
	const schemas: CollectionSchemas = Object.fromEntries(
		collections.map((c) => [c.slug, { fields: c.fields.map((f) => f.slug) }]),
	);
	const mapped = validateMapping(mapping, schemas);

	// A stored secret that comes back as something other than text is an envelope the host could not open.
	const outcome = (v: unknown): SecretReadOutcome =>
		typeof v === "string" && v !== "" ? "readable" : v !== null && typeof v === "object" ? "unreadable" : "unset";
	const secrets = Object.fromEntries(SECRET_SETTING_KEYS.map((k) => [k, outcome(values[k])]));
	const encryption = encryptionKeyStatus({ secrets });
	const noTurnstile: NoticeInput | false = secrets.turnstileSecretKey === "unset" && {
		severity: "warning",
		title: "Turnstile is not set up",
		message:
			"No Turnstile secret key is saved, so checkout runs without a bot check. Add the Turnstile site key and secret key in the plugin settings.",
	};

	return respond([
		header("Events setup"),
		...notices([mapped.banner, encryption.banner, noTurnstile]),
		fieldsBlock([
			{ label: "Events collection", value: mapping.eventsCollection || "(not set)" },
			{ label: "Start field", value: mapping.fieldStartsAt || "(not set)" },
			{ label: "End field", value: mapping.fieldEndsAt || "(not set)" },
			{ label: "Timezone field", value: mapping.fieldTimezone || "(not set)" },
			{ label: "Venue field", value: mapping.fieldVenue || "(not set)" },
			{ label: "Turnstile", value: secrets.turnstileSecretKey === "unset" ? "Not set up" : "Secret key saved" },
		]),
		actions([link("Open plugin settings", { kind: "plugin-settings" }, { appearance: "primary" })]),
	]);
}

// --- bookings ---------------------------------------------------------------------------------

function bookingRows(items: Page["items"]) {
	return items.map(({ id, data }) => {
		const b = data as BookingDoc;
		return {
			ref: b.ref,
			buyer: b.buyer?.name ?? "",
			email: b.email,
			status: b.status,
			total: b.totals ? formatMoney(b.totals.totalMinor, b.totals.currency) : "",
			event: b.eventId,
			created: b.createdAt,
			id,
		};
	});
}

async function bookingsPage(
	deps: AdminDeps,
	filter: { q?: string; status?: string; cursor?: string },
	extra: Block[] = [],
): Promise<AdminResponse> {
	const q = str(filter.q, 120);
	const status = BOOKING_STATUSES.includes(str(filter.status)) ? str(filter.status) : "";
	const where: Where = {};
	if (status) where.status = status;
	if (q.includes("@")) where.email = q;
	else if (q) where.ref = q.toUpperCase();
	const page = await deps.storage.bookings.query({
		where,
		orderBy: { createdAt: "desc" },
		limit: BOOKINGS_PAGE,
		...(filter.cursor ? { cursor: filter.cursor } : {}),
	});
	return respond([
		header("Bookings"),
		...extra,
		form({
			fields: [
				textInput("q", "Booking reference or buyer email", { initialValue: q }),
				select("status", "Status", [{ label: "Any status", value: "" }, ...optionsOf(BOOKING_STATUSES)], {
					initialValue: status,
				}),
			],
			submit: { label: "Search", actionId: "bookings.search" },
		}),
		table({
			columns: [
				col("ref", "Reference", "code"),
				col("buyer", "Buyer"),
				col("email", "Email"),
				col("status", "Status", "badge"),
				col("total", "Total"),
				col("event", "Event", "code"),
				col("created", "Booked", "relative_time"),
			],
			rows: bookingRows(page.items),
			pageActionId: `bookings.page:${status}`,
			...(page.hasMore && page.cursor && !q ? { nextCursor: page.cursor } : {}),
			emptyText: "No bookings match.",
		}),
	]);
}

// --- events (list for attendees and the editor) -----------------------------------------------

/**
 * Titles for one page of events: a single `content:read` listing (plus the settings read for the
 * mapped collection), matched by entry id. An event outside that listing, or a read that fails,
 * falls back to the title copied onto its config, then to its id.
 */
async function eventTitles(deps: AdminDeps): Promise<Map<string, string>> {
	const titles = new Map<string, string>();
	if (!deps.content) return titles;
	try {
		const { collection } = mappingOf(await deps.settings.list());
		const found = await deps.content.list(collection, { limit: 100 });
		for (const entry of found.items) {
			const t = entry.data?.title;
			if (typeof t === "string" && t.trim() !== "") titles.set(entry.id, t.trim());
		}
	} catch {
		// Titles are a convenience: the list still works with ids.
	}
	return titles;
}

async function eventsList(deps: AdminDeps, title: string, actionId: string, label: string, lead?: string) {
	const page = await deps.storage.event_configs.query({ limit: 50 });
	const titles = await eventTitles(deps);
	return respond([
		header(title),
		...(lead ? [context(lead)] : []),
		table({
			columns: [
				col("title", "Event"),
				col("event", "ID", "code"),
				col("status", "Status", "badge"),
				col("sold", "Sold", "number"),
				col("capacity", "Capacity", "number"),
				col("open", "", "element"),
			],
			rows: page.items.map(({ id, data }) => {
				const c = data as EventConfigDoc;
				return {
					title: titles.get(id) ?? c.info?.title ?? id,
					event: id,
					status: c.status,
					sold: c.sold,
					capacity: c.capacity,
					open: button(actionId, label, { value: id }),
				};
			}),
			pageActionId: "events.page",
			emptyText: "No events have booking settings yet.",
		}),
	]);
}

// --- attendees --------------------------------------------------------------------------------

const exportUrl = (deps: AdminDeps, eventId: string, cursor?: string) =>
	`${deps.origin}/_emdash/api/plugins/${encodeURIComponent(deps.pluginId)}/attendees/export?eventId=${encodeURIComponent(eventId)}${
		cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""
	}`;

async function attendeesPage(
	deps: AdminDeps,
	eventId: string,
	opts: { cursor?: string; q?: string; extra?: Block[] } = {},
): Promise<AdminResponse> {
	const q = str(opts.q, 120).toLowerCase();
	let items: Page["items"] = [];
	let next: string | undefined;
	if (q) {
		// No index on names: scan a few pages of the event and filter.
		let cursor: string | undefined;
		for (let i = 0; i < NAME_SEARCH_PAGES && items.length < NAME_SEARCH_MATCHES; i++) {
			const page = await deps.storage.attendees.query({
				where: { eventId },
				limit: EXPORT_PAGE_SIZE,
				...(cursor ? { cursor } : {}),
			});
			items.push(
				...page.items.filter(({ data }) => {
					const a = data as AttendeeDoc;
					return [a.name, a.email, a.code].some((f) => f?.toLowerCase().includes(q));
				}),
			);
			if (!page.hasMore || !page.cursor) break;
			cursor = page.cursor;
		}
	} else {
		const page = await deps.storage.attendees.query({
			where: { eventId },
			limit: EXPORT_PAGE_SIZE,
			...(opts.cursor ? { cursor: opts.cursor } : {}),
		});
		items = page.items;
		next = page.hasMore ? page.cursor : undefined;
	}
	const ids = [...new Set(items.map((i) => (i.data as AttendeeDoc).bookingId))];
	const bookings = ids.length > 0 ? await deps.storage.bookings.getMany(ids) : new Map<string, unknown>();

	const rows = items.map(({ id, data }) => {
		const a = data as AttendeeDoc;
		const b = bookings.get(a.bookingId) as BookingDoc | undefined;
		const value = { id, eventId };
		return {
			name: a.name,
			email: a.email,
			code: a.code,
			booking: b?.status ?? "missing",
			checkedIn: a.checkedInAt ? a.checkedInAt : "Not checked in",
			action: a.checkedInAt
				? button("attendees.undo", "Undo", { style: "danger", value })
				: button("attendees.checkin", "Check in", { style: "primary", value }),
		};
	});

	return respond([
		header(`Attendees: ${eventId}`),
		...(opts.extra ?? []),
		form({
			fields: [textInput("eventId", "Event", { initialValue: eventId }), textInput("code", "Check-in code")],
			submit: { label: "Check in by code", actionId: "attendees.checkin_code" },
		}),
		form({
			fields: [
				textInput("eventId", "Event", { initialValue: eventId }),
				textInput("q", "Name, email or code", { initialValue: q }),
			],
			submit: { label: "Search attendees", actionId: "attendees.search" },
		}),
		actions([
			link(q ? "Download CSV (first part)" : "Download CSV (this page)", {
				kind: "external",
				url: exportUrl(deps, eventId, q ? undefined : opts.cursor),
			}),
			button("attendees.open", "Back to first page", { value: eventId, style: "secondary" }),
		]),
		table({
			columns: [
				col("name", "Name"),
				col("email", "Email"),
				col("code", "Code", "code"),
				col("booking", "Booking", "badge"),
				col("checkedIn", "Checked in", "text"),
				col("action", "", "element"),
			],
			rows,
			pageActionId: `attendees.page:${eventId}`,
			...(next ? { nextCursor: next } : {}),
			emptyText: q ? "No attendee matches." : "No attendees yet.",
		}),
	]);
}

const REFUSALS: Record<string, (r: { bookingStatus?: string; name?: string }) => string> = {
	NOT_FOUND: () => "No attendee has that code for this event.",
	BOOKING_NOT_CONFIRMED: (r) =>
		`The booking is not confirmed (it is ${r.bookingStatus ?? "unknown"}), so this ticket is not valid.`,
	ATTENDEE_NOT_VALID: () => "This ticket is not valid yet: a waiver may still be pending, or it was cancelled.",
};

async function doCheckIn(
	deps: AdminDeps,
	target: { id: string } | { code: string },
	eventId: string,
): Promise<AdminResponse> {
	const result = await checkIn(deps.storage, target, iso(deps.now), eventId);
	let banner: NoticeInput;
	if (result.ok) {
		banner = { severity: "info", title: `Checked in: ${result.name}`, message: `At ${result.checkedInAt}.` };
	} else if (result.reason === "ALREADY_CHECKED_IN") {
		banner = {
			severity: "warning",
			title: "Already checked in",
			message: `${result.name ?? "This attendee"} was first checked in at ${result.checkedInAt ?? "an unknown time"}.`,
		};
	} else {
		banner = {
			severity: "error",
			title: "Cannot check in",
			message: REFUSALS[result.reason]?.(result) ?? "Check-in refused.",
		};
	}
	return attendeesPage(deps, eventId, { extra: notices([banner]) });
}

// --- event editor -----------------------------------------------------------------------------

function editorForm(eventId: string, state: EventState, extra: Block[] = []): AdminResponse {
	const config = state.config as EventConfigDoc;
	const fields = [
		select("status", "Sales status", EVENT_STATUS_OPTIONS, { initialValue: config.status }),
		...state.ticketTypes.flatMap(({ id, data }) => {
			const t = data as TicketTypeDoc;
			return [
				numberInput(`capacity:${id}`, `${t.name}: capacity`, { initialValue: t.capacity, min: 1 }),
				textInput(`price:${id}`, `${t.name}: price (${config.currency})`, {
					initialValue: fromMinor(t.priceMinor, config.currency),
				}),
			];
		}),
	];
	return respond([
		header(`Edit event: ${eventId}`),
		...extra,
		context(
			`Sold ${config.sold}, held ${Math.max(config.reserved - config.sold, 0)}, capacity ${config.capacity}. Only the ticket types you change are written.`,
		),
		form({ fields, submit: { label: "Save changes", actionId: "event.save" }, blockId: `event:${eventId}` }),
	]);
}

async function openEditor(deps: AdminDeps, eventId: string): Promise<AdminResponse> {
	const state = await loadEventState(eventId, deps.storage);
	if (!state.config) {
		return respond([
			header("Edit event"),
			...notices([{ severity: "error", title: "Event not found", message: "This event has no booking settings yet." }]),
		]);
	}
	return editorForm(eventId, state);
}

async function saveEditor(
	deps: AdminDeps,
	eventId: string,
	blockId: string | undefined,
	values: Record<string, unknown>,
) {
	const id = eventId || (blockId?.startsWith("event:") ? blockId.slice(6) : "");
	if (!id) return respond(notices([{ severity: "error", title: "Choose an event first" }]));
	const state = await loadEventState(id, deps.storage);
	const stored = state.config;
	if (!stored) return openEditor(deps, id);
	const { catalog: _derived, info: _info, ...config } = stored;

	// Send every ticket type (an omitted one would be deleted), but only the changed ones differ
	// from what is stored, so `config/save` writes only those.
	let changed = 0;
	const status = str(values.status) || stored.status;
	if (status !== stored.status) changed++;
	const applied: Array<{ id: string; data: unknown }> = [];
	const ticketTypes = state.ticketTypes.map(({ id: ttId, data }) => {
		const t = data as TicketTypeDoc;
		const item: Record<string, unknown> = { ...t, id: ttId };
		const after: TicketTypeDoc = { ...t };
		applied.push({ id: ttId, data: after });
		const capacity = values[`capacity:${ttId}`];
		if (capacity !== undefined && capacity !== "" && Number(capacity) !== t.capacity) {
			item.capacity = Number(capacity);
			after.capacity = Number(capacity);
			changed++;
		}
		const price = str(values[`price:${ttId}`], 20);
		if (price !== "") {
			let minor: number | null = null;
			try {
				minor = toMinor(price, stored.currency);
			} catch {
				minor = null;
			}
			if (minor === null || minor !== t.priceMinor) {
				delete item.priceMinor;
				item.price = price;
				if (minor !== null) after.priceMinor = minor;
				changed++;
			}
		}
		return item;
	});
	if (changed === 0) {
		return editorForm(id, state, NOTHING_TO_SAVE());
	}

	const out = (await saveConfig(
		deps.storage,
		{
			eventId: id,
			config: { ...config, status },
			ticketTypes,
			occurrences: state.occurrences.map(({ id: oid, data }) => ({ ...(data as object), id: oid })),
		},
		deps.newId,
		state,
	)) as { ok: boolean; issues?: Array<{ path: string; code: string }> };

	if (out.ok) {
		// Show what was written without reading it back (a read would go over the call budget).
		const fresh: EventState = {
			...state,
			config: { ...stored, status: status as EventConfigDoc["status"] },
			ticketTypes: applied,
		};
		return editorForm(id, fresh, SAVED());
	}
	return editorForm(id, state, saveRefused(out.issues ?? []));
}

// --- dashboard widget -------------------------------------------------------------------------

async function salesWidget(deps: AdminDeps): Promise<AdminResponse> {
	const page = await deps.storage.event_configs.query({ where: { status: "on_sale" }, limit: 5 });
	if (page.items.length === 0) return respond([context("No events are on sale.")]);
	return respond(
		page.items.map(({ id, data }) => {
			const c = data as EventConfigDoc;
			// `reserved` counts every held seat, sold ones included.
			const held = Math.max(c.reserved - c.sold, 0);
			return meter({
				label: id,
				value: c.sold,
				max: c.capacity,
				customValue: `${c.sold} sold, ${held} held of ${c.capacity}`,
			});
		}),
	);
}

// --- dispatch ---------------------------------------------------------------------------------

const eventIdOf = (value: unknown): string => {
	if (typeof value === "string") return str(value);
	if (value && typeof value === "object") return str((value as { eventId?: unknown }).eventId);
	return "";
};

export async function handleAdmin(deps: AdminDeps, interaction: AdminInteraction): Promise<AdminResponse> {
	if (interaction.type === "page_load") {
		switch (interaction.page) {
			case "/setup":
				return setupPage(deps);
			case "/bookings":
				return bookingsPage(deps, {});
			case "/attendees":
				return eventsList(
					deps,
					"Attendees",
					"attendees.open",
					"Open",
					"Choose an event to see its attendees and check people in.",
				);
			case "/events":
				return eventsList(deps, "Events", "events.edit", "Edit", "Change capacity, prices and sales status.");
			case "widget:sales":
				return salesWidget(deps);
			default:
				return respond(notices([{ severity: "error", title: "Page not found" }]));
		}
	}

	const [action = "", suffix = ""] = interaction.action_id.split(/:(.*)/s);
	if (interaction.type === "form_submit") {
		const v = interaction.values;
		switch (action) {
			case "bookings.search":
				return bookingsPage(deps, { q: str(v.q), status: str(v.status) });
			case "attendees.search":
				return attendeesPage(deps, eventIdOf(v.eventId), { q: str(v.q) });
			case "attendees.checkin_code": {
				const code = str(v.code, 80);
				if (!code)
					return attendeesPage(deps, eventIdOf(v.eventId), {
						extra: notices([{ severity: "error", title: "Enter a check-in code" }]),
					});
				return doCheckIn(deps, { code }, eventIdOf(v.eventId));
			}
			case "event.save":
				return saveEditor(deps, eventIdOf(v.eventId), interaction.block_id, v);
		}
	} else {
		const value = interaction.value;
		switch (action) {
			case "bookings.page":
				return bookingsPage(deps, { status: suffix, cursor: str(value, 500) });
			case "attendees.open":
				return attendeesPage(deps, eventIdOf(value));
			case "attendees.page":
				return attendeesPage(deps, suffix, { cursor: str(value, 500) });
			case "attendees.checkin": {
				const id = str((value as { id?: unknown } | null)?.id);
				return doCheckIn(deps, { id }, eventIdOf(value));
			}
			case "attendees.undo": {
				const eventId = eventIdOf(value);
				const out = await undoCheckIn(deps.storage, str((value as { id?: unknown } | null)?.id));
				const banner: NoticeInput = out.ok
					? { severity: "info", title: `Check-in undone: ${out.name}` }
					: { severity: "error", title: "Attendee not found" };
				return attendeesPage(deps, eventId, { extra: notices([banner]) });
			}
			case "events.edit":
				return openEditor(deps, eventIdOf(value));
			case "events.page":
				return eventsList(deps, "Events", "events.edit", "Edit");
		}
	}
	return respond(notices([{ severity: "error", title: "Unknown action" }]));
}
