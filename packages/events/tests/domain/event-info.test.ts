import { describe, expect, it } from "vitest";

import { eventInfoOf, infoOfEntry, loadEventInfo, mappingOf } from "../../src/domain/event-info";

// The one place that reads the T041 mapping settings (T046; used by emails, calendar and the public routes).

const entry = {
	title: "Winter Concert",
	starts_at: "2026-11-14T19:00:00Z",
	ends_at: "2026-11-14T21:00:00Z",
	timezone: "Europe/London",
	venue: "Town Hall",
	when: "2026-12-01T10:00:00Z",
	place: "Annexe",
};

describe("EV-FR-01 mapping settings", () => {
	it("defaults to the snake_case fields of the events collection", () => {
		expect(mappingOf([])).toEqual({
			collection: "events",
			startsAt: "starts_at",
			endsAt: "ends_at",
			timezone: "timezone",
			venue: "venue",
		});
	});

	it("reads the collection and every field from the settings, ignoring blanks", () => {
		const mapping = mappingOf([
			{ key: "eventsCollection", value: "gigs" },
			{ key: "fieldStartsAt", value: "when" },
			{ key: "fieldEndsAt", value: "  " },
			{ key: "fieldTimezone", value: "tz" },
			{ key: "fieldVenue", value: "place" },
		]);
		expect(mapping).toEqual({
			collection: "gigs",
			startsAt: "when",
			endsAt: "ends_at",
			timezone: "tz",
			venue: "place",
		});
	});
});

describe("EV-FR-01 public info from an entry", () => {
	it("reads the mapped fields and normalises the instants", () => {
		const mapping = mappingOf([
			{ key: "fieldStartsAt", value: "when" },
			{ key: "fieldVenue", value: "place" },
		]);
		expect(infoOfEntry(entry, mapping)).toEqual({
			title: "Winter Concert",
			startsAt: "2026-12-01T10:00:00.000Z",
			endsAt: null,
			timezone: "Europe/London",
			venue: "Annexe",
		});
	});

	it("is null without a usable start, and drops an end that is not after it", () => {
		const mapping = mappingOf([]);
		expect(infoOfEntry({ title: "x" }, mapping)).toBeNull();
		expect(infoOfEntry({ ...entry, starts_at: "soon" }, mapping)).toBeNull();
		expect(infoOfEntry({ ...entry, ends_at: entry.starts_at }, mapping)?.endsAt).toBeNull();
	});

	it("turns a stored info into the emails' shape, with an occurrence's own start and the entry's duration", () => {
		const doc = infoOfEntry(entry, mappingOf([])) as NonNullable<ReturnType<typeof infoOfEntry>>;
		expect(eventInfoOf(doc)).toMatchObject({
			startsAt: Date.parse(entry.starts_at),
			endsAt: Date.parse(entry.ends_at),
		});
		const occ = { startsAt: "2026-11-21T19:00:00Z", endsAt: null } as never;
		expect(eventInfoOf(doc, occ)).toMatchObject({
			startsAt: Date.parse("2026-11-21T19:00:00Z"),
			endsAt: Date.parse("2026-11-21T21:00:00Z"),
			timeZone: "Europe/London",
			venue: "Town Hall",
		});
	});
});

describe("EV-FR-03 the entry's slug on the info (T056)", () => {
	it("EV-FR-03 keeps the slug of a flat hook record", () => {
		expect(infoOfEntry({ ...entry, slug: "winter-concert" }, mappingOf([]))?.slug).toBe("winter-concert");
	});

	it("EV-FR-03 reads a content item (fields under data, slug beside them), the shape EmDash passes to hooks", () => {
		const item = { id: "ev1", slug: "winter-concert", status: "published", data: entry };
		expect(infoOfEntry(item, mappingOf([]))).toEqual({
			title: "Winter Concert",
			startsAt: "2026-11-14T19:00:00.000Z",
			endsAt: "2026-11-14T21:00:00.000Z",
			timezone: "Europe/London",
			venue: "Town Hall",
			slug: "winter-concert",
		});
	});

	it("EV-FR-03 leaves the slug out when the entry has none", () => {
		expect(infoOfEntry(entry, mappingOf([]))).not.toHaveProperty("slug");
	});
});

describe("EV-FR-08 loading the info", () => {
	const deps = (config: unknown, calls: string[]) => ({
		settings: {
			list: async () => {
				calls.push("settings");
				return [{ key: "fieldStartsAt", value: "when" }];
			},
		},
		content: {
			get: async (collection: string) => {
				calls.push(`content:${collection}`);
				return { data: entry };
			},
		},
		storage: {
			event_configs: {
				get: async () => {
					calls.push("config");
					return config;
				},
			},
			occurrences: { get: async () => null },
		},
	});

	it("takes the copy on the config and touches nothing else", async () => {
		const calls: string[] = [];
		const info = infoOfEntry(entry, mappingOf([])) as never;
		const got = await loadEventInfo(deps({ info }, calls), "ev1");
		expect(got?.title).toBe("Winter Concert");
		expect(calls).toEqual(["config"]);
	});

	it("falls back to the entry, through the mapping, for a config without a copy", async () => {
		const calls: string[] = [];
		const got = await loadEventInfo(deps({}, calls), "ev1");
		expect(got?.startsAt).toBe(Date.parse("2026-12-01T10:00:00Z"));
		expect(calls).toEqual(["config", "settings", "content:events"]);
	});
});
