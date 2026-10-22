// Booking fixtures (T055): puts the events core's storage for seed/events-fixture.json straight
// into the freshly seeded database, as `config/save` would write it (counter-free catalog on the
// event config and the entry's public info, ticket types with zero counters). Saving through the admin route needs a signed-in
// admin, which a production build has no bypass for. Runs after `emdash seed`, before the server.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PLUGIN_ID = "semics-events";

export function applyBookingFixtures(root) {
	const fixture = JSON.parse(readFileSync(resolve(root, "seed/events-fixture.json"), "utf8"));
	const db = new DatabaseSync(resolve(root, "data.db"));
	const now = new Date().toISOString();
	const put = db.prepare(
		`INSERT INTO _plugin_storage (plugin_id, collection, id, data, revision, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	);
	try {
		for (const [slug, event] of Object.entries(fixture)) {
			const entry = db
				.prepare("SELECT id, title, starts_at, ends_at, timezone, venue FROM ec_events WHERE slug = ?")
				.get(slug);
			if (!entry) throw new Error(`[e2e] fixture event ${slug} is not in the seed`);
			const catalog = { ticketTypes: {}, occurrences: {} };
			let sort = 0;
			for (const [id, t] of Object.entries(event.ticketTypes)) {
				const doc = {
					eventId: entry.id,
					name: t.name,
					priceMinor: t.priceMinor,
					capacity: t.capacity,
					reserved: 0,
					sold: 0,
					minPerOrder: null,
					maxPerOrder: t.maxPerOrder ?? null,
					salesStart: null,
					salesEnd: null,
					hidden: false,
					sort: sort++,
				};
				put.run(PLUGIN_ID, "ticket_types", id, JSON.stringify(doc), crypto.randomUUID(), now, now);
				catalog.ticketTypes[id] = {
					capacity: doc.capacity,
					priceMinor: doc.priceMinor,
					hidden: false,
					minPerOrder: null,
					maxPerOrder: doc.maxPerOrder,
					salesStart: null,
					salesEnd: null,
				};
			}
			const config = {
				status: "on_sale",
				capacity: event.capacity,
				reserved: 0,
				sold: 0,
				salesStart: null,
				salesEnd: null,
				currency: event.currency,
				questions: [],
				signature: { required: false, mode: "each_attendee" },
				waitlistEnabled: false,
				recurrence: null,
				catalog,
				// The copy of the entry's public fields that content:afterSave keeps (T046).
				info: {
					title: entry.title,
					startsAt: new Date(entry.starts_at).toISOString(),
					endsAt: entry.ends_at ? new Date(entry.ends_at).toISOString() : null,
					timezone: entry.timezone ?? null,
					venue: entry.venue ?? null,
				},
			};
			put.run(PLUGIN_ID, "event_configs", entry.id, JSON.stringify(config), crypto.randomUUID(), now, now);
		}
	} finally {
		db.close();
	}
}
