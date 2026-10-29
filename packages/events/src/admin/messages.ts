import { type Block, notices } from "@semics-tech/shared";

/** Plain-language messages for `config/save` refusals, shared by the event editor page and the editor panel. */
const ISSUE_MESSAGES: Record<string, string> = {
	CAPACITY_BELOW_RESERVED: "Capacity is below the seats already taken.",
	INVALID_CAPACITY: "Capacity must be a whole number of at least 1.",
	INVALID_PRICE: "Price must be an amount such as 15.00.",
	INVALID_STATUS: "Choose one of the listed statuses.",
	INVALID_DATE: "Enter a date such as 2026-12-01 19:30.",
	INVALID_WINDOW: "A date must end after it starts.",
	INVALID_RECURRENCE: "Use a rule such as FREQ=WEEKLY;BYDAY=MO;COUNT=10.",
	INVALID_SCHEDULE:
		"A schedule needs days (MO-SU), times (09:00), minutes, places, 1-90 days ahead, no RRULE or dates.",
	INVALID_NAME: "A ticket type needs a name (max 100).",
	INVALID_CURRENCY: "Use a currency code such as GBP.",
	ITEM_IN_USE: "That item has bookings and cannot be removed.",
	UNKNOWN_ID: "An item changed meanwhile. Reload and try again.",
	TOO_MANY: "Too many items for one event.",
	TOO_MANY_CHANGES: "Save fewer changes at a time.",
	WAIVER_TEMPLATE_REQUIRED: "A required waiver needs a template id (letters, digits, - and _).",
};

export function issueMessage(code: string, path = ""): string {
	return `${ISSUE_MESSAGES[code] ?? code}${path && code !== "TOO_MANY_CHANGES" ? ` (${path})` : ""}`;
}

/** The banner for a refused save: every issue in plain language. */
export function saveRefused(issues: Array<{ path: string; code: string }>): Block[] {
	const tooMany = issues.some((i) => i.code === "TOO_MANY_CHANGES");
	const message = issues.map((i) => issueMessage(i.code, i.path)).join(" ") || "The change was refused.";
	return notices([{ severity: "error", title: tooMany ? "Too many changes at once" : "Not saved", message }]);
}

export const NOTHING_TO_SAVE = (): Block[] =>
	notices([{ severity: "info", title: "Nothing to save", message: "No values were changed." }]);

export const SAVED = (message = "The event was updated."): Block[] =>
	notices([{ severity: "info", title: "Saved", message }]);
