/** Small helpers the admin pages and the editor panel share (one copy in the bundle, R42). */
import type { Block, TableColumn } from "@semics-tech/shared";

import { EVENT_STATUSES, OCCURRENCE_STATUSES } from "../domain/config";

export const respond = (blocks: Block[]): { blocks: Block[] } => ({ blocks });

/** A trimmed string of at most `max` characters; "" for anything else. */
export const str = (v: unknown, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Select options for status values, labelled with spaces for underscores. */
export const optionsOf = (values: readonly string[]) =>
	values.map((s) => ({ label: s.replaceAll("_", " "), value: s }));

export const EVENT_STATUS_OPTIONS = optionsOf(EVENT_STATUSES);
export const OCCURRENCE_STATUS_OPTIONS = optionsOf(OCCURRENCE_STATUSES);

/** A table column; `format` is left out when not given. */
export const col = (key: string, label: string, format?: TableColumn["format"]): TableColumn =>
	format === undefined ? { key, label } : { key, label, format };
