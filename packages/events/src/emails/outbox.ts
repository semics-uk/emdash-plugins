/**
 * Events' side of the shared email outbox (T015, EV-FR-08, EV-FR-09).
 *
 * Checkout (`confirm-<bookingId>`, kind `booking_confirmed`, T048) and cancel (`cancel-<bookingId>`,
 * kind `booking_cancelled`, T049) queue rows that hold only ids (`OutboxDoc`). The recurring
 * `outbox-drain` cron task runs the shared `drainOutbox` over an adapter that presents those rows
 * as `OutboxRecord`s with a stub message; the `email.send` it is given renders the real message
 * from fresh reads and sends that. So the queue never holds a body, a token or a ticket code, and
 * there is nothing to scrub after sending. Delivery is at-least-once: a crash between `email.send`
 * and the final `putMany` sends the mail again (with a newer code; the earlier link stops working).
 *
 * Booking link: the access token is never emailed. Each confirmation mints a one-time code
 * (`generateToken`), stores only its hash on the booking (`redeemHash`, 7 days) and puts the code
 * in the link `/booking?ref=<ref>&k=<code>`. The booking page exchanges it with a POST to
 * `public/booking/redeem` (`src/routes/redeem.ts`), which swaps in a fresh access token for the
 * HttpOnly cookie. The queued row and the logs never see the code.
 *
 * Budget (R22: hard limit 10, target 8): one message per tick. A tick is `outbox.query` + the
 * message + `outbox.putMany`. A confirmation reads the booking, its attendees, the `eventsCollection`
 * setting and the event entry (+ the occurrence for a recurring event), writes the code hash and
 * sends: 6 calls, 7 with an occurrence, so 8 or 9 per tick. A cancellation skips the attendees and
 * the code: 6 or 7. An empty tick is 1. The cost is a throughput of one email a minute.
 */
import {
	type DrainResult,
	drainOutbox,
	generateToken,
	hashToken,
	type OutboxMessage,
	type OutboxRecord,
	type OutboxStatus,
	type OutboxStorage,
} from "@semics-tech/shared";
import type { CronEvent, PluginContext } from "emdash/plugin";

import { type EventInfoDeps, loadEventInfo } from "../domain/event-info";
import type { AttendeeDoc, BookingDoc, OutboxDoc } from "../storage/schema";
import { cancellationEmail, confirmationEmail } from "./confirmation";

export const OUTBOX_TASK = "outbox-drain";
/** Every minute; a tick with nothing due costs one storage call. */
export const OUTBOX_SCHEDULE = "* * * * *";
export const OUTBOX_PER_TICK = 1;
/** How long an emailed booking link stays redeemable. */
export const REDEEM_TTL_MS = 7 * 86_400_000;

type Item = { id: string; data: unknown };

export interface OutboxCollection {
	put(id: string, data: OutboxDoc): Promise<void>;
	putMany(items: Array<{ id: string; data: OutboxDoc }>): Promise<void>;
	query(o: {
		where?: Record<string, unknown>;
		orderBy?: Record<string, "asc" | "desc">;
		limit?: number;
	}): Promise<{ items: Array<{ id: string; data: unknown }> }>;
}

export interface DrainDeps {
	storage: {
		bookings: {
			get(id: string): Promise<unknown>;
			updateIf(
				id: string,
				args: { where: Record<string, unknown>; set?: Record<string, unknown> },
			): Promise<{ applied: boolean }>;
		};
		attendees: { query(o: { where: Record<string, unknown>; limit: number }): Promise<{ items: Item[] }> };
		occurrences: { get(id: string): Promise<unknown> };
	};
	outbox: OutboxCollection;
	settings: EventInfoDeps["settings"];
	content: EventInfoDeps["content"];
	/** `ctx.email`; absent when no transport is configured. */
	email: { send(message: OutboxMessage): Promise<unknown> } | undefined;
	origin: string;
	pluginId: string;
	siteName: string;
	now: number;
}

const iso = (ms: number) => new Date(ms).toISOString();

interface Row {
	id: string;
	doc: OutboxDoc;
}

/** The shared outbox's view of the `outbox` collection; `rows` remembers each row read this tick. */
function adapt(collection: OutboxCollection, stubs: WeakMap<OutboxMessage, Row>): OutboxStorage {
	const rows = new Map<string, OutboxDoc>();
	return {
		put: async () => {
			throw new Error("events enqueue outbox rows themselves (T048, T049)");
		},
		putMany: (items) =>
			collection.putMany(
				items.map(({ id, data }) => {
					const doc = rows.get(id) as OutboxDoc;
					const { lastError: _stale, ...rest } = doc;
					return {
						id,
						data: {
							...rest,
							status: data.status,
							attempts: data.attempts,
							nextAttemptAt: iso(data.nextAttemptAt),
							...(data.lastError !== undefined ? { lastError: data.lastError } : {}),
							...(data.sentAt !== undefined ? { sentAt: iso(data.sentAt) } : {}),
						},
					};
				}),
			),
		query: async ({
			status,
			nextAttemptAtLte,
			limit,
		}: {
			status: OutboxStatus;
			nextAttemptAtLte?: number;
			limit: number;
		}) => {
			const { items } = await collection.query({
				where: { status, ...(nextAttemptAtLte === undefined ? {} : { nextAttemptAt: { lte: iso(nextAttemptAtLte) } }) },
				orderBy: { nextAttemptAt: "asc" },
				limit,
			});
			return {
				items: items.map(({ id, data }): { id: string; data: OutboxRecord } => {
					const doc = data as OutboxDoc;
					rows.set(id, doc);
					const message: OutboxMessage = { to: doc.to, subject: "", text: "" };
					stubs.set(message, { id, doc });
					const nextAttemptAt = Date.parse(doc.nextAttemptAt);
					return {
						id,
						data: {
							message,
							status: doc.status,
							attempts: doc.attempts,
							nextAttemptAt: Number.isFinite(nextAttemptAt) ? nextAttemptAt : 0,
							createdAt: Number.isFinite(nextAttemptAt) ? nextAttemptAt : 0,
							...(doc.lastError !== undefined ? { lastError: doc.lastError } : {}),
						},
					};
				}),
			};
		},
	};
}

const calendarUrl = (d: DrainDeps, eventId: string) =>
	`${d.origin}/_emdash/api/plugins/${encodeURIComponent(d.pluginId)}/public/event/ics?${new URLSearchParams({ eventId })}`;

async function loadBooking(d: DrainDeps, bookingId: string): Promise<BookingDoc | null> {
	return (await d.storage.bookings.get(bookingId)) as BookingDoc | null;
}

function eventDeps(d: DrainDeps): EventInfoDeps {
	return { settings: d.settings, content: d.content, storage: d.storage };
}

/** A confirmation: null when the booking is gone or no longer confirmed (nothing to send). */
async function renderConfirmation(d: DrainDeps, bookingId: string): Promise<OutboxMessage | null> {
	const booking = await loadBooking(d, bookingId);
	if (booking?.status !== "confirmed") return null;
	const [attendees, event] = await Promise.all([
		d.storage.attendees.query({ where: { bookingId }, limit: 100 }),
		loadEventInfo(eventDeps(d), booking.eventId, booking.occurrenceId),
	]);
	if (!event) throw new Error("event entry not found");
	const code = generateToken();
	const minted = await d.storage.bookings.updateIf(bookingId, {
		where: { status: "confirmed" },
		set: { redeemHash: await hashToken(code), redeemExpiresAt: iso(d.now + REDEEM_TTL_MS) },
	});
	if (!minted.applied) return null;
	const names = attendees.items
		.map((i) => i.data as AttendeeDoc)
		.filter((a) => a.status !== "cancelled")
		.map((a) => a.name);
	return confirmationEmail({
		to: booking.email,
		buyerName: booking.buyer.name,
		bookingRef: booking.ref,
		attendees: names,
		event,
		bookingUrl: `${d.origin}/booking?${new URLSearchParams({ ref: booking.ref, k: code })}`,
		calendarUrl: calendarUrl(d, booking.eventId),
		siteName: d.siteName,
	});
}

async function renderCancellation(d: DrainDeps, bookingId: string): Promise<OutboxMessage | null> {
	const booking = await loadBooking(d, bookingId);
	if (!booking) return null;
	const event = await loadEventInfo(eventDeps(d), booking.eventId, booking.occurrenceId);
	if (!event) throw new Error("event entry not found");
	return cancellationEmail({
		to: booking.email,
		buyerName: booking.buyer.name,
		bookingRef: booking.ref,
		attendees: [],
		event,
		calendarUrl: calendarUrl(d, booking.eventId),
		siteName: d.siteName,
	});
}

async function render(d: DrainDeps, doc: OutboxDoc): Promise<OutboxMessage | null> {
	const bookingId = doc.payload.bookingId;
	if (typeof bookingId !== "string") throw new Error(`outbox row has no bookingId (kind ${doc.kind})`);
	if (doc.kind === "booking_confirmed") return renderConfirmation(d, bookingId);
	if (doc.kind === "booking_cancelled") return renderCancellation(d, bookingId);
	throw new Error(`unknown outbox kind ${doc.kind}`);
}

/** One drain tick over the events outbox. */
export async function drainEventsOutbox(d: DrainDeps): Promise<DrainResult> {
	const stubs = new WeakMap<OutboxMessage, Row>();
	const send = d.email;
	return drainOutbox({
		storage: adapt(d.outbox, stubs),
		email: send && {
			send: async (stub) => {
				const row = stubs.get(stub);
				if (!row) throw new Error("outbox message has no row");
				const message = await render(d, row.doc);
				if (message) await send.send(message);
			},
		},
		now: d.now,
		maxPerTick: OUTBOX_PER_TICK,
	});
}

export function drainDepsOf(ctx: PluginContext, now: number): DrainDeps {
	const storage = ctx.storage as unknown as DrainDeps["storage"] & { outbox: OutboxCollection };
	let origin = "";
	try {
		origin = new URL(ctx.site.url).origin;
	} catch {
		origin = "";
	}
	return {
		storage,
		outbox: storage.outbox,
		settings: ctx.settings,
		content: ctx.content ?? { get: async () => null },
		email: ctx.email,
		origin,
		pluginId: ctx.plugin.id,
		siteName: ctx.site.name,
		now,
	};
}

/** The `cron` hook's share for the recurring drain; true when `event` was ours. */
export async function runOutboxJob(event: CronEvent, ctx: PluginContext, now = Date.now()): Promise<boolean> {
	if (event.name !== OUTBOX_TASK) return false;
	const result = await drainEventsOutbox(drainDepsOf(ctx, now));
	if (result.gaveUp > 0) ctx.log.error("emails given up after repeated failures", { count: result.gaveUp });
	return true;
}

/** `plugin:activate`: (re)schedule the recurring drain. */
export async function scheduleOutbox(ctx: PluginContext): Promise<void> {
	await ctx.cron?.schedule(OUTBOX_TASK, { schedule: OUTBOX_SCHEDULE });
}
