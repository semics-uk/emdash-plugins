/**
 * Keeps what a person typed when a booking is refused (`<BookingWithWaiver>`). The refusal is a redirect back to
 * the page with codes only: personal details never go in a URL, and a server-rendered copy could end up in a page
 * cache. So the browser keeps them: on submit this tab's `sessionStorage` takes the form's values, and the
 * page the refusal lands on puts them back. Any other visit discards them; so does closing the tab. Without
 * JavaScript (or storage) the form comes back empty with its message, as before. No text; no imports.
 */

/** The parts of a form control this needs. */
export interface KeptField {
	name: string;
	type: string;
	value: string;
	checked?: boolean;
	/** A select's choices: one that has since gone (sold out) is not chosen again. */
	options?: Iterable<{ value: string; disabled: boolean }>;
}

/** A refusal comes straight back; anything older is someone returning later. */
export const KEPT_MS = 5 * 60_000;
export const keptKey = (eventId: string) => `semics-waiver-form:${eventId}`;

type Stored = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** What to keep: what the person chose, never hidden fields (the idempotency key, the security check's token). */
export function collectFields(fields: Iterable<KeptField>): Record<string, string | boolean> {
	const out: Record<string, string | boolean> = {};
	for (const f of fields) {
		if (!f.name || f.type === "hidden" || f.type === "submit" || f.type === "button") continue;
		if (f.type === "checkbox") {
			if (f.checked) out[f.name] = true;
		} else if (f.value) out[f.name] = f.value;
	}
	return out;
}

export function applyFields(fields: Iterable<KeptField>, kept: Record<string, string | boolean>): void {
	for (const f of fields) {
		const value = kept[f.name];
		if (value === undefined || f.type === "hidden") continue;
		if (f.type === "checkbox") f.checked = value === true;
		else if (typeof value === "string" && ![...(f.options ?? [])].some((o) => o.value === value && o.disabled)) {
			f.value = value;
		}
	}
}

export function saveKept(storage: Stored, eventId: string, fields: Iterable<KeptField>, now: number): void {
	try {
		storage.setItem(keptKey(eventId), JSON.stringify({ at: now, values: collectFields(fields) }));
	} catch {
		// Private browsing, a full quota: the form just comes back empty.
	}
}

/**
 * The values to restore: only straight after a refusal of this event's form, once, and only while fresh. A visit
 * through the browser's history (`fromHistory`, Back to the refusal's URL) is not that, and on a shared device could
 * be someone else, so it gets nothing.
 */
export function takeKept(storage: Stored, eventId: string, search: URLSearchParams, now: number, fromHistory = false) {
	try {
		const raw = storage.getItem(keptKey(eventId));
		storage.removeItem(keptKey(eventId));
		if (!raw || fromHistory || !search.get("waiver_error") || search.get("waiver_event") !== eventId) return null;
		const { at, values } = JSON.parse(raw) as { at: number; values: Record<string, string | boolean> };
		return now - at <= KEPT_MS ? values : null;
	} catch {
		return null;
	}
}

/** Whether this page load came from the browser's Back or Forward. */
const fromHistory = () =>
	(performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined)?.type === "back_forward";

/** Wires every booking form on the page. Run before the picker's script, which shows the date the select holds. */
export function keepWaiverForms(doc: Document, storage: Stored, url: URL): void {
	for (const form of doc.querySelectorAll<HTMLFormElement>("form[data-keep-values]")) {
		const eventId = (form.elements.namedItem("eventId") as HTMLInputElement | null)?.value ?? "";
		const fields = () => [...form.elements] as unknown as HTMLInputElement[];
		const kept = takeKept(storage, eventId, url.searchParams, Date.now(), fromHistory());
		if (kept) applyFields(fields(), kept);
		let submitted = false;
		form.addEventListener("submit", () => {
			submitted = true;
			saveKept(storage, eventId, fields(), Date.now());
		});
		// Back to this very page from the browser's memory, typed details and all: start it afresh.
		addEventListener("pageshow", (event) => {
			if (!event.persisted || !submitted) return;
			takeKept(storage, eventId, url.searchParams, Date.now(), true);
			location.reload();
		});
	}
}

// Never in the way of the picker's script, which runs after this: storage access itself can throw.
try {
	if (typeof document !== "undefined") keepWaiverForms(document, sessionStorage, new URL(location.href));
} catch {
	// Storage is blocked: the form just comes back empty.
}
