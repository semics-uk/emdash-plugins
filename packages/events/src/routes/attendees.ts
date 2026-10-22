import { toRouteError } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import { pluginResponse } from "emdash/plugin";

import { toCsv } from "../admin/csv";
import type { AttendeeDoc, BookingDoc } from "../storage/schema";

/**
 * Attendee check-in, undo and CSV export (EV-FR-11, EV-US-5, EV-US-7). Attendee documents are
 * `<bookingId>-<n>` and carry a unique check-in `code`.
 *
 * Check-in reads the attendee (1 call, or a query by `code`), reads its booking, and writes with
 * `updateIf` guarded on `checkedInAt: null`, so two scanners cannot both succeed; the loser is told
 * the first time. Cancelling a booking does not touch its attendees (T049), so check-in refuses
 * anyone whose booking is not `confirmed`, and an attendee whose waiver is still pending (Pro,
 * EV-FR-12). Undo clears the time (stored as `null`).
 *
 * Export is paged: one part is up to 100 attendees (one `attendees.query` plus one `bookings.getMany`),
 * with a cursor for the next part, so a large event never goes over the bridge-call budget.
 */
type Where = Record<string, unknown>;
type Item = { id: string; data: unknown };

export interface AttendeeStorage {
	attendees: {
		get(id: string): Promise<unknown>;
		query(o: {
			where?: Where;
			limit?: number;
			cursor?: string;
		}): Promise<{ items: Item[]; hasMore?: boolean; cursor?: string }>;
		updateIf(id: string, args: { where: Where; set?: Where }): Promise<{ applied: boolean }>;
	};
	bookings: { get(id: string): Promise<unknown>; getMany(ids: string[]): Promise<Map<string, unknown>> };
}

export type CheckInTarget = { id: string } | { code: string };

export type CheckInFailure =
	| "NOT_FOUND"
	| "BOOKING_NOT_CONFIRMED"
	| "WAIVER_PENDING"
	| "ATTENDEE_NOT_VALID"
	| "ALREADY_CHECKED_IN";

export type CheckInResult =
	| { ok: true; id: string; name: string; checkedInAt: string }
	| {
			ok: false;
			reason: CheckInFailure;
			id?: string;
			name?: string;
			checkedInAt?: string;
			bookingStatus?: string;
			/** `WAIVER_PENDING` only: what a signing link for this attendee needs (EV-FR-12). */
			waiver?: { attendee: AttendeeDoc; booking: BookingDoc };
	  };

export const EXPORT_PAGE_SIZE = 100;

async function find(storage: AttendeeStorage, target: CheckInTarget): Promise<{ id: string; doc: AttendeeDoc } | null> {
	if ("id" in target) {
		const doc = (await storage.attendees.get(target.id)) as AttendeeDoc | null;
		return doc ? { id: target.id, doc } : null;
	}
	const found = await storage.attendees.query({ where: { code: target.code }, limit: 1 });
	const [hit] = found.items;
	return hit ? { id: hit.id, doc: hit.data as AttendeeDoc } : null;
}

/** Check one attendee in at `nowIso`. `eventId`, when given, must match the attendee's event. */
export async function checkIn(
	storage: AttendeeStorage,
	target: CheckInTarget,
	nowIso: string,
	eventId?: string,
): Promise<CheckInResult> {
	const hit = await find(storage, target);
	if (!hit || (eventId !== undefined && hit.doc.eventId !== eventId)) return { ok: false, reason: "NOT_FOUND" };
	const { id, doc } = hit;
	const who = { id, name: doc.name };
	const booking = (await storage.bookings.get(doc.bookingId)) as BookingDoc | null;
	if (booking?.status !== "confirmed") {
		return { ok: false, reason: "BOOKING_NOT_CONFIRMED", ...who, bookingStatus: booking?.status ?? "missing" };
	}
	// A waiver booking confirms once the buyer has signed; other adults stay pending until their
	// own receipt arrives, and are refused here with a signing link (EV-FR-12).
	if (doc.status === "pending" && booking.waiver) {
		return { ok: false, reason: "WAIVER_PENDING", ...who, waiver: { attendee: doc, booking } };
	}
	if (doc.status !== "valid") return { ok: false, reason: "ATTENDEE_NOT_VALID", ...who };
	if (doc.checkedInAt) return { ok: false, reason: "ALREADY_CHECKED_IN", ...who, checkedInAt: doc.checkedInAt };
	const written = await storage.attendees.updateIf(id, { where: { checkedInAt: null }, set: { checkedInAt: nowIso } });
	if (!written.applied) {
		// Someone else got there first: show their time.
		const current = (await storage.attendees.get(id)) as AttendeeDoc | null;
		return {
			ok: false,
			reason: "ALREADY_CHECKED_IN",
			...who,
			...(current?.checkedInAt ? { checkedInAt: current.checkedInAt } : {}),
		};
	}
	return { ok: true, ...who, checkedInAt: nowIso };
}

/** Clear a check-in. Harmless when there is none. */
export async function undoCheckIn(
	storage: AttendeeStorage,
	id: string,
): Promise<{ ok: true; name: string } | { ok: false; reason: "NOT_FOUND" }> {
	const doc = (await storage.attendees.get(id)) as AttendeeDoc | null;
	if (!doc) return { ok: false, reason: "NOT_FOUND" };
	if (doc.checkedInAt) await storage.attendees.updateIf(id, { where: {}, set: { checkedInAt: null } });
	return { ok: true, name: doc.name };
}

export const CSV_HEADER = [
	"Name",
	"Email",
	"Code",
	"Ticket type",
	"Booking",
	"Booking status",
	"Attendee status",
	"Checked in",
] as const;

/** One part of an event's attendee CSV (header plus up to 100 rows) and the cursor of the next. */
export async function exportAttendeesCsv(
	storage: AttendeeStorage,
	input: { eventId: string; cursor?: string },
): Promise<{ csv: string; nextCursor?: string }> {
	const page = await storage.attendees.query({
		where: { eventId: input.eventId },
		limit: EXPORT_PAGE_SIZE,
		...(input.cursor ? { cursor: input.cursor } : {}),
	});
	const docs = page.items.map((i) => i.data as AttendeeDoc);
	const bookings = await storage.bookings.getMany([...new Set(docs.map((d) => d.bookingId))]);
	const rows = docs.map((d) => {
		const b = bookings.get(d.bookingId) as BookingDoc | undefined;
		return [d.name, d.email, d.code, d.ticketTypeId, b?.ref ?? "", b?.status ?? "", d.status, d.checkedInAt ?? ""];
	});
	return {
		csv: toCsv(CSV_HEADER, rows),
		...(page.hasMore && page.cursor ? { nextCursor: page.cursor } : {}),
	};
}

type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];
type Handler = (routeCtx: { input?: unknown }, ctx: PluginContext) => Promise<unknown>;

/** `GET attendees/export?eventId=&cursor=`: raw `text/csv`, admin only (not a public route). */
export const ATTENDEE_ROUTES: Record<string, RouteDef> = {
	"attendees/export": {
		methods: ["GET"],
		response: "raw",
		handler: (async (routeCtx, ctx) => {
			const input = (routeCtx.input ?? {}) as { eventId?: unknown; cursor?: unknown };
			if (typeof input.eventId !== "string" || input.eventId === "" || input.eventId.length > 200) {
				return pluginResponse({
					status: 400,
					headers: { "content-type": "text/plain; charset=utf-8" },
					body: { kind: "text", value: toRouteError("BAD_REQUEST").body.error.message },
				});
			}
			const out = await exportAttendeesCsv(ctx.storage as unknown as AttendeeStorage, {
				eventId: input.eventId,
				...(typeof input.cursor === "string" && input.cursor ? { cursor: input.cursor } : {}),
			});
			return pluginResponse({
				headers: {
					"content-type": "text/csv; charset=utf-8",
					"content-disposition": `attachment; filename="attendees-${input.eventId.replace(/[^\w-]/g, "_")}.csv"`,
				},
				body: { kind: "text", value: out.csv },
			});
		}) as Handler,
	},
};
