import { generateToken, hashToken } from "@semics-tech/shared";

import type { DrainDeps } from "../../src/emails/outbox";
import { FakeKv, makeStore, meter } from "../domain/fake-storage";

/** A confirmed booking for a one-off event in `timezone`, with attendees and a queued outbox row. */
export const ID = "bk_0123456789abcdef0123456789abcdef";
export const REF = "ABCDEFGHJK";
export const START = Date.parse("2026-11-14T19:00:00.000Z");
export const NOW = Date.parse("2026-11-01T12:00:00.000Z");

export type Doc = Record<string, unknown>;

export async function world({
	timezone = "Europe/London",
	status = "confirmed",
	occurrence = false,
	kind = "booking_confirmed",
	title = "Winter Concert",
	names = ["Ada Lovelace", "Grace Hopper"],
	denormalised = true,
}: {
	timezone?: string;
	status?: string;
	occurrence?: boolean;
	kind?: "booking_confirmed" | "booking_cancelled";
	title?: string;
	names?: string[];
	/** Whether the event config carries `info` (the copy of the entry's public fields). */
	denormalised?: boolean;
} = {}) {
	const storage = makeStore();
	const kv = new FakeKv();
	const token = generateToken();
	storage.bookings.set(ID, {
		ref: REF,
		eventId: "ev1",
		...(occurrence ? { occurrenceId: "oc1" } : {}),
		status,
		releaseClaimedAt: null,
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		email: "ada@example.com",
		lines: [{ ticketTypeId: "tt_a", qty: names.length, unitPriceMinor: 0 }],
		totals: { subtotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: "GBP" },
		answers: {},
		accessTokenHash: await hashToken(token),
		createdAt: new Date(NOW - 3_600_000).toISOString(),
	});
	if (occurrence) {
		storage.occurrences.set("oc1", {
			eventId: "ev1",
			startsAt: new Date(START + 7 * 86_400_000).toISOString(),
			capacity: 10,
			reserved: 0,
			sold: 0,
			status: "open",
		});
	}
	for (const [i, name] of names.entries()) {
		storage.attendees.set(`${ID}-${i + 1}`, {
			bookingId: ID,
			eventId: "ev1",
			ticketTypeId: "tt_a",
			name,
			email: "ada@example.com",
			code: `code-${i + 1}_x-Y`,
			status: "valid",
		});
	}
	storage.outbox.set(kind === "booking_confirmed" ? `confirm-${ID}` : `cancel-${ID}`, {
		kind,
		to: "ada@example.com",
		payload: { bookingId: ID, bookingRef: REF },
		attempts: 0,
		nextAttemptAt: new Date(NOW).toISOString(),
		status: "pending",
	});
	storage.event_configs.set("ev1", {
		status: "on_sale",
		capacity: 100,
		reserved: 0,
		sold: 0,
		currency: "GBP",
		...(denormalised
			? {
					info: {
						title,
						startsAt: new Date(START).toISOString(),
						endsAt: new Date(START + 2 * 3_600_000).toISOString(),
						timezone,
						venue: "Town Hall, Market Street",
					},
				}
			: {}),
	});
	const sent: Array<{ to: string; subject: string; text: string; html?: string }> = [];
	const content = {
		get: async (collection: string, id: string) => {
			meter.calls++;
			if (collection !== "events" || id !== "ev1") return null;
			return {
				id,
				data: {
					title,
					starts_at: new Date(START).toISOString(),
					ends_at: new Date(START + 2 * 3_600_000).toISOString(),
					timezone,
					venue: "Town Hall, Market Street",
				},
			};
		},
	};
	const settings = {
		list: async (): Promise<Array<{ key: string; value: unknown }>> => {
			meter.calls++;
			return [];
		},
	};
	const deps = (over: Partial<DrainDeps> = {}): DrainDeps => ({
		storage: storage as unknown as DrainDeps["storage"],
		outbox: storage.outbox as unknown as DrainDeps["outbox"],
		settings,
		content,
		email: {
			send: async (m) => {
				meter.calls++;
				sent.push(m as (typeof sent)[number]);
			},
		},
		origin: "https://site.test",
		pluginId: "r_abc",
		siteName: "Town Hall",
		now: NOW,
		...over,
	});
	const booking = () => storage.bookings.docs.get(ID) as Doc;
	return { storage, kv, token, sent, content, settings, deps, booking };
}
