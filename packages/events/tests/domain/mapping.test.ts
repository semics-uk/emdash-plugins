import { describe, expect, it } from "vitest";

import { type CollectionSchemas, type EventsMapping, validateMapping } from "../../src/domain/mapping";

const mapping: EventsMapping = {
	eventsCollection: "events",
	fieldStartsAt: "starts_at",
	fieldEndsAt: "ends_at",
	fieldTimezone: "timezone",
	fieldVenue: "venue",
};

const schemas: CollectionSchemas = {
	events: { fields: ["title", "starts_at", "ends_at", "timezone", "venue"] },
	posts: { fields: ["title"] },
};

describe("validateMapping (EV-FR-01)", () => {
	it("passes a valid mapping with no banner", () => {
		expect(validateMapping(mapping, schemas)).toEqual({ ok: true, problems: [], banner: null });
	});

	it("names each missing field in the banner", () => {
		const result = validateMapping(mapping, { events: { fields: ["title", "starts_at", "ends_at"] } });
		expect(result.ok).toBe(false);
		expect(result.problems).toEqual([
			{ setting: "fieldTimezone", field: "timezone", reason: "missing-field" },
			{ setting: "fieldVenue", field: "venue", reason: "missing-field" },
		]);
		expect(result.banner?.severity).toBe("error");
		expect(result.banner?.message).toBe(
			'The "events" collection has no field "timezone" (Timezone field) or "venue" (Venue field). Add the field to the collection, or choose another field in the Events settings.',
		);
	});

	it("uses singular wording for one missing field", () => {
		const result = validateMapping(mapping, { events: { fields: ["starts_at", "ends_at", "timezone"] } });
		expect(result.banner?.message).toBe(
			'The "events" collection has no field "venue" (Venue field). Add the field to the collection, or choose another field in the Events settings.',
		);
	});

	it("fails when the mapped collection does not exist", () => {
		const result = validateMapping({ ...mapping, eventsCollection: "gigs" }, schemas);
		expect(result.ok).toBe(false);
		expect(result.problems).toEqual([{ setting: "eventsCollection", field: "gigs", reason: "missing-collection" }]);
		expect(result.banner?.message).toBe(
			'The collection "gigs" does not exist. Choose an existing collection in the Events settings. Available: events, posts.',
		);
	});

	it("requires the start and timezone settings to be filled in", () => {
		const result = validateMapping({ ...mapping, fieldStartsAt: " ", fieldTimezone: "" }, schemas);
		expect(result.problems.map((p) => [p.setting, p.reason])).toEqual([
			["fieldStartsAt", "unset"],
			["fieldTimezone", "unset"],
		]);
		expect(result.banner?.message).toBe(
			"Start field and Timezone field are not set. Choose the field in the Events settings.",
		);
	});

	it("treats end and venue as optional when left blank", () => {
		expect(validateMapping({ ...mapping, fieldEndsAt: "", fieldVenue: "" }, schemas).ok).toBe(true);
	});

	it("reports an empty collection setting as unset", () => {
		const result = validateMapping({ ...mapping, eventsCollection: "" }, schemas);
		expect(result.problems).toEqual([{ setting: "eventsCollection", field: "", reason: "unset" }]);
		expect(result.banner?.message).toContain("Events collection");
	});

	it("omits the available list when the site has no collections", () => {
		const result = validateMapping(mapping, {});
		expect(result.banner?.message).toBe(
			'The collection "events" does not exist. Choose an existing collection in the Events settings.',
		);
	});
});
