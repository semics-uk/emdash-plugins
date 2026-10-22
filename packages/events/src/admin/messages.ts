/** Plain-language messages for `config/save` refusals, shared by the event editor page and the editor panel. */
const ISSUE_MESSAGES: Record<string, string> = {
	CAPACITY_BELOW_RESERVED: "Capacity cannot be lower than the seats already reserved or sold.",
	INVALID_CAPACITY: "Capacity must be a whole number of at least 1.",
	INVALID_PRICE: "Price must be an amount such as 15.00.",
	INVALID_STATUS: "Choose one of the listed statuses.",
	INVALID_DATE: "Enter a date such as 2026-12-01 19:30.",
	INVALID_WINDOW: "A date must end after it starts.",
	INVALID_NAME: "A ticket type needs a name of up to 100 characters.",
	INVALID_CURRENCY: "Use a three-letter currency code such as GBP.",
	ITEM_IN_USE: "That item already has bookings and cannot be removed.",
	UNKNOWN_ID: "An item changed while you were editing. Reload and try again.",
	TOO_MANY: "That is more items than one event can have.",
	TOO_MANY_CHANGES: "Too many changes at once: save fewer changes at a time.",
	WAIVER_TEMPLATE_REQUIRED: "A required waiver needs an E-sign template id (letters, digits, - and _).",
};

export function issueMessage(code: string, path = ""): string {
	return `${ISSUE_MESSAGES[code] ?? code}${path && code !== "TOO_MANY_CHANGES" ? ` (${path})` : ""}`;
}
