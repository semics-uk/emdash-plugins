/**
 * Events collection mapping validation (EV-FR-01).
 *
 * The settings map the site's events collection and the fields that hold start, end, timezone and
 * venue. The caller reads the collections with `schema:read` and passes their field names in;
 * this module only decides whether the mapping holds and what the admin banner says. Pure: no I/O.
 */

export interface EventsMapping {
	eventsCollection: string;
	fieldStartsAt: string;
	fieldEndsAt: string;
	fieldTimezone: string;
	fieldVenue: string;
}

export type CollectionSchemas = Readonly<Record<string, { fields: readonly string[] }>>;

export type MappingSetting = keyof EventsMapping;
export type MappingProblemReason = "unset" | "missing-collection" | "missing-field";

export interface MappingProblem {
	setting: MappingSetting;
	/** The value that failed: the collection slug or the field name. */
	field: string;
	reason: MappingProblemReason;
}

export interface MappingBanner {
	severity: "error";
	title: string;
	message: string;
}

export interface MappingResult {
	ok: boolean;
	problems: MappingProblem[];
	banner: MappingBanner | null;
}

export const LABELS: Record<MappingSetting, string> = {
	eventsCollection: "Events collection",
	fieldStartsAt: "Start field",
	fieldEndsAt: "End field",
	fieldTimezone: "Timezone field",
	fieldVenue: "Venue field",
};

const REQUIRED: readonly MappingSetting[] = ["fieldStartsAt", "fieldTimezone"];
const FIELD_SETTINGS: readonly MappingSetting[] = ["fieldStartsAt", "fieldEndsAt", "fieldTimezone", "fieldVenue"];
const TITLE = "Events field mapping needs attention";

function join(parts: string[]): string {
	return parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} or ${parts[parts.length - 1]}`;
}

function fail(problems: MappingProblem[], message: string): MappingResult {
	return { ok: false, problems, banner: { severity: "error", title: TITLE, message } };
}

export function validateMapping(mapping: EventsMapping, schemas: CollectionSchemas): MappingResult {
	const slug = mapping.eventsCollection.trim();
	if (slug === "") {
		return fail(
			[{ setting: "eventsCollection", field: "", reason: "unset" }],
			`${LABELS.eventsCollection} is not set. Choose the collection that holds your events in the Events settings.`,
		);
	}

	const schema = schemas[slug];
	if (!schema) {
		const available = Object.keys(schemas).sort().join(", ");
		return fail(
			[{ setting: "eventsCollection", field: slug, reason: "missing-collection" }],
			`The collection "${slug}" does not exist. Choose an existing collection in the Events settings.${available ? ` Available: ${available}.` : ""}`,
		);
	}

	const unset: MappingProblem[] = [];
	const missing: MappingProblem[] = [];
	for (const setting of FIELD_SETTINGS) {
		const field = mapping[setting].trim();
		if (field === "") {
			if (REQUIRED.includes(setting)) unset.push({ setting, field: "", reason: "unset" });
		} else if (!schema.fields.includes(field)) {
			missing.push({ setting, field, reason: "missing-field" });
		}
	}

	if (unset.length > 0) {
		const names = unset.map((p) => LABELS[p.setting]);
		return fail(
			[...unset, ...missing],
			`${names.join(" and ")} ${names.length > 1 ? "are" : "is"} not set. Choose the field in the Events settings.`,
		);
	}
	if (missing.length > 0) {
		const named = missing.map((p) => `"${p.field}" (${LABELS[p.setting]})`);
		return fail(
			missing,
			`The "${slug}" collection has no field ${join(named)}. Add the field to the collection, or choose another field in the Events settings.`,
		);
	}
	return { ok: true, problems: [], banner: null };
}
