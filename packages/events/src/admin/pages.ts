import {
	actions,
	type Block,
	button,
	column,
	context,
	fieldsBlock,
	form,
	formatMoney,
	header,
	link,
	type NoticeInput,
	notices,
	select,
	table,
	textInput,
} from "@semics-tech/shared";

import { eraseBookings, type RetentionStorage } from "../cron/retention";
import { BOOKING_TRANSITIONS } from "../domain/booking-state";
import { encryptionKeyStatus, type SecretReadOutcome } from "../domain/encryption";
import { mappingOf } from "../domain/event-info";
import { type CollectionSchemas, type EventsMapping, LABELS, validateMapping } from "../domain/mapping";
import { settingsObject } from "../domain/settings";
import { iso } from "../domain/time";
import { type ApprovalDeps, approveBooking, declineBooking } from "../routes/approval";
import { type AttendeeStorage, checkIn, EXPORT_PAGE_SIZE, undoCheckIn } from "../routes/attendees";
import type { RefundStep } from "../routes/booking";
import type { ConfigStorage } from "../routes/config";
import { type AttendeeDoc, type BookingDoc, type EventConfigDoc, SECRET_SETTING_KEYS } from "../storage/schema";
import { handlePanel, type PanelDeps, type PanelInteraction } from "./panel";
import { initial, optionsOf, respond, soldMeter, str } from "./ui";

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
	ConfigStorage &
	RetentionStorage & {
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
	/**
	 * The Pro waiver step's signing link for an attendee refused at check-in with a pending waiver
	 * (EV-FR-12): staff open it on their device and check the attendee in once they have signed.
	 * Absent in the Free edition, which then checks such attendees in (no waivers to sign, R44);
	 * `null` when no link can be made (no pairing).
	 */
	signingLink?: SigningLink;
	/** The edition's refund step, for declining a paid booking awaiting approval (Pro, T131/T132). */
	refund?: RefundStep;
}

/** Makes the signing link for an attendee whose waiver is pending (Pro seam, `adminRoute`). */
export type SigningLink = (args: {
	attendeeId: string;
	attendee: AttendeeDoc;
	booking: BookingDoc;
	origin: string;
}) => Promise<string | null>;

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
/** Every booking status, for the status filter. */
const BOOKING_STATUSES = Object.keys(BOOKING_TRANSITIONS);

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
	const values = settingsObject(entries);
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
		message: "Checkout runs without a bot check; add the Turnstile keys.",
	};

	return respond([
		header("Events setup"),
		...notices([mapped.banner, encryption.banner, noTurnstile]),
		fieldsBlock([
			...(Object.keys(LABELS) as Array<keyof EventsMapping>).map((k) => ({
				label: LABELS[k],
				value: mapping[k] || "(not set)",
			})),
		]),
		actions([link("Open plugin settings", { kind: "plugin-settings" }, { appearance: "primary" })]),
	]);
}

// --- bookings ---------------------------------------------------------------------------------

function bookingRows(items: Page["items"]) {
	return items.map(({ id, data }) => {
		const b = data as BookingDoc;
		const waiting = b.status === "awaiting_approval";
		return {
			...(waiting && {
				approve: button("bookings.approve", "Approve", { style: "primary", value: id }),
				decline: button("bookings.decline_ask", "Decline", { style: "danger", value: id }),
			}),
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
				textInput("q", REF_OR_EMAIL, initial(q)),
				select("status", "Status", [{ label: "Any status", value: "" }, ...optionsOf(BOOKING_STATUSES)], {
					initialValue: status,
				}),
			],
			submit: { label: "Search", actionId: "bookings.search" },
		}),
		table({
			columns: [
				column("ref", "Reference", "code"),
				column("buyer", "Buyer"),
				column("email", "Email"),
				column("status", "Status", "badge"),
				column("total", "Total"),
				column("event", "Event", "code"),
				column("created", "Booked", "relative_time"),
				column("approve", "", "element"),
				column("decline", "", "element"),
			],
			rows: bookingRows(page.items),
			pageActionId: `bookings.page:${status}`,
			...(page.hasMore && page.cursor && !q ? { nextCursor: page.cursor } : {}),
			emptyText: "No bookings match.",
		}),
		...retentionBlocks(),
	]);
}

// --- approval (T131) -------------------------------------------------------------------------

const approvalDeps = (deps: AdminDeps) => deps as unknown as ApprovalDeps;

/** Approve or decline, then the waiting bookings with the outcome (the list is one more call). */
async function decide(deps: AdminDeps, id: string, reason?: string): Promise<AdminResponse> {
	const out = (await (reason === undefined
		? approveBooking(approvalDeps(deps), id)
		: declineBooking(approvalDeps(deps), id, reason, 1))) as {
		ok: boolean;
		bookingRef?: string;
		status?: string;
		error?: { message: string };
	};
	const banner: NoticeInput = out.ok
		? { severity: "info", title: `${out.bookingRef}: ${out.status}` }
		: { severity: "error", title: "Not changed", message: out.error?.message ?? "" };
	return bookingsPage(deps, { status: "awaiting_approval" }, notices([banner]));
}

// --- deletion on request (EV-FR-20) -----------------------------------------------------------

const REF_OR_EMAIL = "Booking reference or buyer email";

const retentionBlocks = (): Block[] => [
	header("Delete personal data"),
	context("Erases a booking's or an email's personal data. Live bookings are kept."),
	form({
		fields: [textInput("target", REF_OR_EMAIL)],
		submit: { label: "Find", actionId: "retention.preview" },
	}),
];

/** A deletion request's outcome: the Bookings header, the banners, `blocks`, then the request form. */
const retentionView = (banners: NoticeInput[], blocks: Block[] = []) =>
	respond([header("Bookings"), ...notices(banners), ...blocks, ...retentionBlocks()]);

const bookingCount = (n: number) => `${n} booking${n === 1 ? "" : "s"}`;

/** The bookings and (by email) waitlist entries a deletion request names: two queries. */
async function targetQuery(deps: AdminDeps, target: string) {
	const email = target.includes("@") ? target.trim().toLowerCase() : "";
	const none = { items: [] };
	const [page, waitlist] = target
		? await Promise.all([
				deps.storage.bookings.query({ where: email ? { email } : { ref: target.toUpperCase() }, limit: 10 }),
				email ? deps.storage.waitlist.query({ where: { email }, limit: 100 }) : none,
			])
		: [none, none];
	return { page, waitlist: waitlist.items.map((i) => i.id) };
}

const entries = (n: number) => `${n} waitlist entr${n === 1 ? "y" : "ies"}`;

async function retentionPreview(deps: AdminDeps, target: string): Promise<AdminResponse> {
	const { page, waitlist } = await targetQuery(deps, target);
	const n = page.items.filter((i) => !(i.data as BookingDoc).erasedAt).length;
	const found = [n && bookingCount(n), waitlist.length && entries(waitlist.length)].filter(Boolean);
	const banner: NoticeInput = found.length
		? { severity: "warning", title: `${found.join(" and ")} found for ${target}` }
		: { severity: "info", title: "Nothing to delete for that reference or email" };
	return retentionView(
		[banner],
		found.length
			? [
					actions([
						button("retention.erase", "Delete personal data", {
							style: "danger",
							value: target,
							confirm: {
								title: "Delete personal data?",
								text: "This cannot be undone.",
								confirm: "Delete",
								deny: "Keep",
								style: "danger",
							},
						}),
					]),
				]
			: [],
	);
}

async function retentionErase(deps: AdminDeps, target: string): Promise<AdminResponse> {
	const { page, waitlist } = await targetQuery(deps, target);
	// One attendee page less when entries go too, so the request stays within 10 calls.
	const out = await eraseBookings(deps.storage, page.items, deps.now, { pages: waitlist.length ? 1 : 2 });
	if (waitlist.length) await deps.storage.waitlist.deleteMany(waitlist);
	const also = waitlist.length ? ` and ${entries(waitlist.length)}` : "";
	const banners: NoticeInput[] = [
		{ severity: "info", title: `Deleted personal data of ${bookingCount(out.erased)}${also}` },
		out.kept > 0 && {
			severity: "warning",
			title: `${out.kept} live booking${out.kept === 1 ? " was" : "s were"} kept`,
			description: "Live bookings of upcoming events are kept.",
		},
		!out.complete && {
			severity: "error",
			title: "Too many attendees to delete in one go",
			description: "Run the deletion again to finish.",
		},
	].filter((b): b is NoticeInput => !!b);
	return retentionView(banners);
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
				column("title", "Event"),
				column("event", "ID", "code"),
				column("status", "Status", "badge"),
				column("sold", "Sold", "number"),
				column("capacity", "Capacity", "number"),
				column("open", "", "element"),
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

	const eventField = () => textInput("eventId", "Event", initial(eventId));
	return respond([
		header(`Attendees: ${eventId}`),
		...(opts.extra ?? []),
		form({
			fields: [eventField(), textInput("code", "Check-in code")],
			submit: { label: "Check in by code", actionId: "attendees.checkin_code" },
		}),
		form({
			fields: [eventField(), textInput("q", "Name, email or code", initial(q))],
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
				column("name", "Name"),
				column("email", "Email"),
				column("code", "Code", "code"),
				column("booking", "Booking", "badge"),
				column("checkedIn", "Checked in", "text"),
				column("action", "", "element"),
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
	BOOKING_NOT_CONFIRMED: (r) => `The booking is not confirmed (${r.bookingStatus ?? "unknown"}).`,
	WAIVER_PENDING: (r) => `${r.name ?? "This attendee"} has not signed the waiver yet.`,
	ATTENDEE_NOT_VALID: () => "This ticket is not valid.",
};

async function doCheckIn(
	deps: AdminDeps,
	target: { id: string } | { code: string },
	eventId: string,
): Promise<AdminResponse> {
	// The signing-link seam is the edition's waiver support: Free (none) does not enforce waivers.
	const result = await checkIn(deps.storage, target, iso(deps.now), eventId, {
		waivers: deps.signingLink !== undefined,
	});
	let banner: NoticeInput;
	const links: Block[] = [];
	if (!result.ok && result.reason === "WAIVER_PENDING" && result.waiver && result.id && deps.signingLink) {
		const url = await deps.signingLink({ attendeeId: result.id, ...result.waiver, origin: deps.origin });
		if (url) links.push(actions([link("Open the signing page", { kind: "external", url })]));
	}
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
			title: result.reason === "WAIVER_PENDING" ? "Waiver not signed" : "Cannot check in",
			message: REFUSALS[result.reason]?.(result) ?? "Check-in refused.",
		};
	}
	return attendeesPage(deps, eventId, { extra: [...notices([banner]), ...links] });
}

// --- event editor ---------------------------------------------------------------------------

/**
 * The "Tickets & booking" panel on the Event editor page, so events of any collection can be edited
 * (the manifest shows the panel only on `events` entries). Every block id names the event, so the
 * panel's own actions come back here with it (R97: this replaced the page's smaller editor).
 */
async function panelPage(deps: AdminDeps, id: string, interaction: PanelInteraction): Promise<AdminResponse> {
	const out = await handlePanel(deps as unknown as PanelDeps, interaction, id);
	return respond(out.blocks.map((b, n) => ({ ...b, block_id: `event:${id}:${n}` })));
}

// --- dashboard widget -------------------------------------------------------------------------

async function salesWidget(deps: AdminDeps): Promise<AdminResponse> {
	const page = await deps.storage.event_configs.query({ where: { status: "on_sale" }, limit: 5 });
	if (page.items.length === 0) return respond([context("No events are on sale.")]);
	return respond(page.items.map(({ id, data }) => soldMeter(id, data as EventConfigDoc)));
}

// --- dispatch ---------------------------------------------------------------------------------

const eventIdOf = (value: unknown): string => {
	if (typeof value === "string") return str(value);
	if (value && typeof value === "object") return str((value as { eventId?: unknown }).eventId);
	return "";
};

const errorNotice = (title: string) => notices([{ severity: "error", title }]);

export async function handleAdmin(deps: AdminDeps, interaction: AdminInteraction): Promise<AdminResponse> {
	const events = () => eventsList(deps, "Events", "events.edit", "Edit");
	if (interaction.type === "page_load") {
		switch (interaction.page) {
			case "/setup":
				return setupPage(deps);
			case "/bookings":
				return bookingsPage(deps, {});
			case "/attendees":
				return eventsList(deps, "Attendees", "attendees.open", "Open", "Choose an event.");
			case "/events":
				return events();
			case "widget:sales":
				return salesWidget(deps);
			default:
				return respond(errorNotice("Page not found"));
		}
	}

	const [action = "", suffix = ""] = interaction.action_id.split(/:(.*)/s);
	// The event editor page is the Tickets & booking panel (R97): its blocks carry `event:<id>:<n>`.
	const panelOf = interaction.block_id?.startsWith("event:") && action.startsWith("panel.");
	if (panelOf) return panelPage(deps, interaction.block_id?.split(":")[1] ?? "", interaction as PanelInteraction);
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
						extra: errorNotice("Enter a check-in code"),
					});
				return doCheckIn(deps, { code }, eventIdOf(v.eventId));
			}
			case "retention.preview":
				return retentionPreview(deps, str(v.target));
			case "bookings.decline":
				return decide(deps, suffix, str(v.reason, 300));
		}
	} else {
		const value = interaction.value;
		switch (action) {
			case "bookings.page":
				return bookingsPage(deps, { status: suffix, cursor: str(value, 500) });
			case "bookings.approve":
				return decide(deps, str(value));
			case "bookings.decline_ask":
				return bookingsPage(deps, { status: "awaiting_approval" }, [
					form({
						fields: [textInput("reason", "Reason (optional, sent to the buyer)")],
						submit: { label: "Decline", actionId: `bookings.decline:${str(value)}` },
					}),
				]);
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
			case "retention.erase":
				return retentionErase(deps, str(value));
			case "events.page":
				return events();
			case "events.edit":
				return panelPage(deps, eventIdOf(value), { type: "panel_load" });
		}
	}
	return respond(errorNotice("Unknown action"));
}
