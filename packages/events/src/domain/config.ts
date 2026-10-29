/**
 * Booking config, ticket type and occurrence validation (EV-FR-02, EV-FR-03).
 *
 * `validateConfigInput` turns an untrusted admin payload plus the stored state into the documents
 * to write, or into every problem found, each with a stable code and the path of the field. Pure:
 * no I/O, ids come from the injected `newId`.
 *
 * Counters (`reserved`, `sold`) are never taken from the input. Existing documents keep their stored
 * values and new ones start at zero, because only the inventory module changes counters. The one
 * rule that touches them is EV-FR-03: capacity may not drop below what is already reserved.
 */
import { err, ok, parseRrule, type Result, toMinor } from "@semics-tech/shared";

import type {
	EventCatalog,
	EventConfigDoc,
	EventQuestion,
	EventStatus,
	OccurrenceDoc,
	OccurrenceStatus,
	SignatureMode,
	TicketTypeDoc,
} from "../storage/schema";
import { APPROVAL_HOURS } from "./booking-state";
import { parseSchedule } from "./schedule";

export type ConfigIssueCode =
	| "INVALID_INPUT"
	| "INVALID_STATUS"
	| "INVALID_CAPACITY"
	| "INVALID_PRICE"
	| "INVALID_CURRENCY"
	| "INVALID_DATE"
	| "INVALID_WINDOW"
	| "INVALID_RECURRENCE"
	| "INVALID_SCHEDULE"
	| "INVALID_APPROVAL"
	| "INVALID_NAME"
	| "INVALID_QUANTITY_LIMITS"
	| "TOO_MANY"
	| "UNKNOWN_ID"
	| "DUPLICATE_ID"
	| "CAPACITY_BELOW_RESERVED"
	| "ITEM_IN_USE"
	/** The save would take more bridge calls than one invocation allows; save in smaller batches. */
	| "TOO_MANY_CHANGES";

export interface ConfigIssue {
	/** Dotted path into the input, for example `ticketTypes[1].priceMinor`. */
	path: string;
	code: ConfigIssueCode;
}

export interface ExistingState {
	config: EventConfigDoc | null;
	ticketTypes: ReadonlyMap<string, TicketTypeDoc>;
	occurrences: ReadonlyMap<string, OccurrenceDoc>;
}

export interface ValidatedConfig {
	config: EventConfigDoc;
	ticketTypes: Array<{ id: string; data: TicketTypeDoc }>;
	occurrences: Array<{ id: string; data: OccurrenceDoc }>;
	deleteTicketTypeIds: string[];
	deleteOccurrenceIds: string[];
}

export const MAX_TICKET_TYPES = 25;
export const MAX_OCCURRENCES = 100;
const MAX_NAME_LENGTH = 100;

export const EVENT_STATUSES: readonly EventStatus[] = ["draft", "on_sale", "paused", "closed", "cancelled"];
export const OCCURRENCE_STATUSES: readonly OccurrenceStatus[] = ["open", "closed", "cancelled"];
const SIGNATURE_MODES: readonly SignatureMode[] = ["each_attendee", "buyer"];

type Obj = Record<string, unknown>;

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 1;

const ISO = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

/** A UTC ISO 8601 string for a real calendar instant with an explicit offset, or null. */
function parseInstant(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const m = ISO.exec(value);
	if (!m) return null;
	const [year, month, day, hour, minute, second] = [m[1], m[2], m[3], m[4], m[5], m[6] ?? "0"].map(Number) as [
		number,
		number,
		number,
		number,
		number,
		number,
	];
	const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
	if (month < 1 || month > 12 || day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

function validCurrency(value: unknown): value is string {
	if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) return false;
	const supported = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
	return supported ? supported("currency").includes(value) : true;
}

class Issues {
	readonly list: ConfigIssue[] = [];
	add(path: string, code: ConfigIssueCode): void {
		this.list.push({ path, code });
	}
}

/** Optional ISO instant: returns the normalised value, or undefined when absent or invalid. */
function optionalInstant(raw: unknown, path: string, issues: Issues): string | undefined {
	if (raw === undefined || raw === null) return undefined;
	const instant = parseInstant(raw);
	if (instant === null) issues.add(path, "INVALID_DATE");
	return instant ?? undefined;
}

function checkWindow(start: string | undefined, end: string | undefined, endPath: string, issues: Issues): void {
	if (start !== undefined && end !== undefined && Date.parse(end) <= Date.parse(start)) {
		issues.add(endPath, "INVALID_WINDOW");
	}
}

function checkCapacity(raw: unknown, stored: { reserved: number } | undefined, path: string, issues: Issues): number {
	if (!isPositiveInt(raw)) {
		issues.add(path, "INVALID_CAPACITY");
		return 0;
	}
	if (stored && raw < stored.reserved) issues.add(path, "CAPACITY_BELOW_RESERVED");
	return raw;
}

function validateConfig(raw: unknown, stored: EventConfigDoc | null, issues: Issues): EventConfigDoc {
	if (!isObj(raw)) {
		issues.add("config", "INVALID_INPUT");
		return validateConfig({}, stored, new Issues());
	}
	const base = raw;

	const status = base.status as EventStatus;
	if (!EVENT_STATUSES.includes(status)) issues.add("config.status", "INVALID_STATUS");
	const capacity = checkCapacity(base.capacity, stored ?? undefined, "config.capacity", issues);
	if (!validCurrency(base.currency)) issues.add("config.currency", "INVALID_CURRENCY");
	const salesStart = optionalInstant(base.salesStart, "config.salesStart", issues);
	const salesEnd = optionalInstant(base.salesEnd, "config.salesEnd", issues);
	checkWindow(salesStart, salesEnd, "config.salesEnd", issues);

	const sig: Obj = isObj(base.signature) ? base.signature : {};
	const mode = sig.mode === undefined ? "each_attendee" : (sig.mode as SignatureMode);
	if (!SIGNATURE_MODES.includes(mode)) issues.add("config.signature.mode", "INVALID_INPUT");
	if (base.signature !== undefined && !isObj(base.signature)) issues.add("config.signature", "INVALID_INPUT");
	const signature: EventConfigDoc["signature"] = { required: sig.required === true, mode };
	if (typeof sig.templateId === "string" && sig.templateId !== "") signature.templateId = sig.templateId;

	const questions = Array.isArray(base.questions) ? (base.questions as EventQuestion[]) : [];
	if (base.questions !== undefined && !Array.isArray(base.questions)) issues.add("config.questions", "INVALID_INPUT");

	const config: EventConfigDoc = {
		status,
		capacity,
		reserved: stored?.reserved ?? 0,
		sold: stored?.sold ?? 0,
		currency: base.currency as string,
		questions,
		signature,
		waitlistEnabled: base.waitlistEnabled === true,
	};
	if (salesStart !== undefined) config.salesStart = salesStart;
	if (salesEnd !== undefined) config.salesEnd = salesEnd;
	if (typeof base.recurrence === "string" && base.recurrence !== "") {
		if (!parseRrule(base.recurrence)) issues.add("config.recurrence", "INVALID_RECURRENCE");
		config.recurrence = base.recurrence;
	}
	if (base.schedule != null) {
		const schedule = parseSchedule(base.schedule);
		if (!schedule || config.recurrence) issues.add("config.schedule", "INVALID_SCHEDULE");
		else config.schedule = schedule;
	}
	// Approval (T131): { required, deadlineHours } in whole hours, 1 to 720 (default 48).
	const ap = base.approval;
	if (ap != null) {
		const hours = isObj(ap) ? (ap.deadlineHours ?? APPROVAL_HOURS) : 0;
		if (!isPositiveInt(hours) || hours > 720) issues.add("config.approval", "INVALID_APPROVAL");
		else config.approval = { required: (ap as Obj).required === true, deadlineHours: hours };
	}
	if (stored?.orphaned !== undefined) config.orphaned = stored.orphaned;
	if (stored?.unpublished !== undefined) config.unpublished = stored.unpublished;
	return config;
}

/** Shared handling of a list of items that may reference stored documents by id. */
function collect<TIn extends Obj, TStored extends { reserved: number; sold: number }, TDoc>(
	name: "ticketTypes" | "occurrences",
	raw: unknown,
	max: number,
	stored: ReadonlyMap<string, TStored>,
	issues: Issues,
	newId: () => string,
	build: (item: TIn, path: string, prior: TStored | undefined) => TDoc,
): { items: Array<{ id: string; data: TDoc }>; deleteIds: string[] } {
	const items: Array<{ id: string; data: TDoc }> = [];
	if (raw !== undefined && !Array.isArray(raw)) {
		issues.add(name, "INVALID_INPUT");
		return { items, deleteIds: [] };
	}
	const list = (raw ?? []) as unknown[];
	if (list.length > max) {
		issues.add(name, "TOO_MANY");
		return { items, deleteIds: [] };
	}
	const kept = new Set<string>();
	list.forEach((entry, index) => {
		const path = `${name}[${index}]`;
		const item: Obj = isObj(entry) ? entry : {};
		if (!isObj(entry)) issues.add(path, "INVALID_INPUT");
		let id: string;
		let prior: TStored | undefined;
		if (typeof item.id === "string" && item.id !== "") {
			id = item.id;
			prior = stored.get(id);
			if (!prior) issues.add(`${path}.id`, "UNKNOWN_ID");
			else if (kept.has(id)) issues.add(`${path}.id`, "DUPLICATE_ID");
			kept.add(id);
		} else {
			id = newId();
		}
		items.push({ id, data: build(item as TIn, path, prior) });
	});
	const deleteIds: string[] = [];
	let inUse = false;
	for (const [id, doc] of stored) {
		if (kept.has(id)) continue;
		if (doc.reserved > 0 || doc.sold > 0) inUse = true;
		else deleteIds.push(id);
	}
	if (inUse) issues.add(name, "ITEM_IN_USE");
	return { items, deleteIds };
}

function priceMinorOf(item: Obj, currency: unknown): number | null {
	if (item.priceMinor !== undefined) {
		return typeof item.priceMinor === "number" && Number.isSafeInteger(item.priceMinor) && item.priceMinor >= 0
			? item.priceMinor
			: null;
	}
	if (typeof item.price !== "string" || typeof currency !== "string") return null;
	try {
		const minor = toMinor(item.price, currency);
		return minor >= 0 ? minor : null;
	} catch {
		return null;
	}
}

function optionalLimit(raw: unknown): number | undefined | null {
	if (raw === undefined || raw === null) return undefined;
	return isPositiveInt(raw) ? raw : null;
}

function buildTicketType(
	eventId: string,
	currency: unknown,
	item: Obj,
	path: string,
	prior: TicketTypeDoc | undefined,
	issues: Issues,
): TicketTypeDoc {
	const name = typeof item.name === "string" ? item.name.trim() : "";
	if (name === "" || name.length > MAX_NAME_LENGTH) issues.add(`${path}.name`, "INVALID_NAME");
	const priceMinor = priceMinorOf(item, currency);
	if (priceMinor === null) issues.add(`${path}.priceMinor`, "INVALID_PRICE");
	const capacity = checkCapacity(item.capacity, prior, `${path}.capacity`, issues);
	const salesStart = optionalInstant(item.salesStart, `${path}.salesStart`, issues);
	const salesEnd = optionalInstant(item.salesEnd, `${path}.salesEnd`, issues);
	checkWindow(salesStart, salesEnd, `${path}.salesEnd`, issues);

	const min = optionalLimit(item.minPerOrder);
	const max = optionalLimit(item.maxPerOrder);
	if (min === null) issues.add(`${path}.minPerOrder`, "INVALID_QUANTITY_LIMITS");
	if (max === null) issues.add(`${path}.maxPerOrder`, "INVALID_QUANTITY_LIMITS");
	if (typeof min === "number" && typeof max === "number" && min > max) {
		issues.add(`${path}.maxPerOrder`, "INVALID_QUANTITY_LIMITS");
	}

	const doc: TicketTypeDoc = {
		eventId,
		name,
		priceMinor: priceMinor ?? 0,
		capacity,
		reserved: prior?.reserved ?? 0,
		sold: prior?.sold ?? 0,
		hidden: item.hidden === true,
		sort: typeof item.sort === "number" && Number.isSafeInteger(item.sort) ? item.sort : 0,
	};
	if (typeof min === "number") doc.minPerOrder = min;
	if (typeof max === "number") doc.maxPerOrder = max;
	if (salesStart !== undefined) doc.salesStart = salesStart;
	if (salesEnd !== undefined) doc.salesEnd = salesEnd;
	return doc;
}

function buildOccurrence(
	eventId: string,
	item: Obj,
	path: string,
	prior: OccurrenceDoc | undefined,
	issues: Issues,
): OccurrenceDoc {
	const startsAt = parseInstant(item.startsAt);
	if (startsAt === null) issues.add(`${path}.startsAt`, "INVALID_DATE");
	const endsAt = optionalInstant(item.endsAt, `${path}.endsAt`, issues);
	checkWindow(startsAt ?? undefined, endsAt, `${path}.endsAt`, issues);
	const capacity = checkCapacity(item.capacity, prior, `${path}.capacity`, issues);

	let status: OccurrenceStatus = prior?.status ?? "open";
	if (item.status !== undefined) {
		if (OCCURRENCE_STATUSES.includes(item.status as OccurrenceStatus)) status = item.status as OccurrenceStatus;
		else issues.add(`${path}.status`, "INVALID_STATUS");
	}

	const doc: OccurrenceDoc = {
		eventId,
		startsAt: startsAt ?? "",
		capacity,
		reserved: prior?.reserved ?? 0,
		sold: prior?.sold ?? 0,
		status,
	};
	if (endsAt !== undefined) doc.endsAt = endsAt;
	return doc;
}

/**
 * Validate an admin save payload `{ config, ticketTypes?, occurrences? }` for one event.
 * Items carrying an `id` update that stored document; items without one are created; stored
 * items left out are deleted, unless they hold or have sold seats (`ITEM_IN_USE`).
 */
export function validateConfigInput(
	eventId: string,
	input: unknown,
	existing: ExistingState,
	newId: () => string,
): Result<ValidatedConfig, ConfigIssue[]> {
	if (!isObj(input)) return err([{ path: "input", code: "INVALID_INPUT" }]);
	const issues = new Issues();

	const config = validateConfig(input.config, existing.config, issues);

	const ticketTypes = collect<Obj, TicketTypeDoc, TicketTypeDoc>(
		"ticketTypes",
		input.ticketTypes,
		MAX_TICKET_TYPES,
		existing.ticketTypes,
		issues,
		newId,
		(item, path, prior) => buildTicketType(eventId, config.currency, item, path, prior, issues),
	);
	const occurrences = collect<Obj, OccurrenceDoc, OccurrenceDoc>(
		"occurrences",
		input.occurrences,
		MAX_OCCURRENCES,
		existing.occurrences,
		issues,
		newId,
		(item, path, prior) => buildOccurrence(eventId, item, path, prior, issues),
	);

	// A schedule's slots are its own (T129): the event has no other dates.
	if (config.schedule && occurrences.items.length > 0) issues.add("config.schedule", "INVALID_SCHEDULE");
	if (issues.list.length > 0) return err(issues.list);
	return ok({
		config,
		ticketTypes: ticketTypes.items,
		occurrences: occurrences.items,
		deleteTicketTypeIds: ticketTypes.deleteIds,
		deleteOccurrenceIds: occurrences.deleteIds,
	});
}

/**
 * The checkout catalog of an event (`EventCatalog`) from its ticket type and occurrence documents.
 * Keys are in id order and optional fields always present (`null` when unset), so two catalogs of
 * the same documents serialise identically whatever order they were read in and however a cleared
 * field was stored. Pure.
 */
export function catalogOf(
	ticketTypes: Iterable<{ id: string; data: TicketTypeDoc }>,
	occurrences: Iterable<{ id: string; data: OccurrenceDoc }>,
): EventCatalog {
	const byId = <T>(items: Iterable<{ id: string; data: T }>) =>
		[...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const catalog: EventCatalog = { ticketTypes: {}, occurrences: {} };
	for (const { id, data: t } of byId(ticketTypes)) {
		catalog.ticketTypes[id] = {
			capacity: t.capacity,
			priceMinor: t.priceMinor,
			hidden: t.hidden === true,
			minPerOrder: t.minPerOrder ?? null,
			maxPerOrder: t.maxPerOrder ?? null,
			salesStart: t.salesStart ?? null,
			salesEnd: t.salesEnd ?? null,
		};
	}
	for (const { id, data: o } of byId(occurrences)) {
		catalog.occurrences[id] = { capacity: o.capacity, startsAt: o.startsAt, status: o.status };
	}
	return catalog;
}
