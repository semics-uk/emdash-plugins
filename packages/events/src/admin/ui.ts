/** Small helpers the admin pages and the editor panel share (one copy in the bundle, R42). */
import { type Block, column, header, meter, toMinor } from "@semics-tech/shared";

import { EVENT_STATUSES, OCCURRENCE_STATUSES } from "../domain/config";

export const respond = (blocks: Block[]): { blocks: Block[] } => ({ blocks });

/** A view of the "Tickets & booking" panel: its header, then `blocks`. */
export const panelView = (blocks: Block[]) => respond([header("Tickets & booking"), ...blocks]);

/** A trimmed string of at most `max` characters; "" for anything else. */
export const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Select options for status values, labelled with spaces for underscores. */
export const optionsOf = (values: readonly string[]) =>
	values.map((s) => ({ label: s.replaceAll("_", " "), value: s }));

export const EVENT_STATUS_OPTIONS = optionsOf(EVENT_STATUSES);
export const OCCURRENCE_STATUS_OPTIONS = optionsOf(OCCURRENCE_STATUSES);

/** The Sold, Held and capacity columns of the panel's tables. */
export const countColumns = (key = "capacity", label = "Capacity") => [
	column("sold", "Sold", "number"),
	column("held", "Held", "number"),
	column(key, label, "number"),
];

/** Seats held but not sold (`reserved` counts sold seats too). */
export const held = (c: { reserved: number; sold: number }) => Math.max(c.reserved - c.sold, 0);

/** The "sold, held of capacity" meter of a counted document. */
export const soldMeter = (label: string, c: { reserved: number; sold: number; capacity: number }) =>
	meter({ label, value: c.sold, max: c.capacity, customValue: `${c.sold} sold, ${held(c)} held of ${c.capacity}` });

/**
 * A typed price that differs from `priceMinor`, or does not parse (the validator then refuses it):
 * the text to save and its minor units (null when unparsable). Null when blank or unchanged.
 */
export function priceEdit(raw: unknown, priceMinor: number, currency: string) {
	const price = str(raw, 20);
	if (price === "") return null;
	let minor: number | null;
	try {
		minor = toMinor(price, currency);
	} catch {
		minor = null;
	}
	return minor === priceMinor ? null : { price, minor };
}
