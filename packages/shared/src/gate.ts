/**
 * Pro gating (BUILD-PLAN §13 "What a key controls", R17): without a valid licence, Pro features
 * stop taking new work, but anything already in flight keeps working (refunds, existing waivers,
 * check-in of sold tickets, reports, export).
 */
import type { LicenceError, LicenceResult } from "./licence";
import { err, ok, type Result } from "./result";

/** `new` starts paid or Pro work; `in-flight` finishes or serves work that already exists. */
export type ProWork = "new" | "in-flight";

/** Default classification of Pro operations. Cores gate any other operation with `gateProWork`. */
export const PRO_OPERATIONS = Object.freeze({
	"events/checkout": "new",
	"events/promo-create": "new",
	"events/reminder-schedule": "new",
	"esign/envelope-send": "new",
	"events/refund": "in-flight",
	"events/checkin": "in-flight",
	"events/reports": "in-flight",
	"esign/waiver-sign": "in-flight",
	"esign/reports": "in-flight",
} as const satisfies Record<string, ProWork>);

export type ProOperation = keyof typeof PRO_OPERATIONS;

/** `ok(true)` when the work may go ahead; otherwise the licence error to show (renewal or invalid). */
export function gateProWork(licence: LicenceResult, work: ProWork): Result<true, LicenceError> {
	if (work === "in-flight" || licence.ok) return ok(true);
	return err(licence.error);
}

export function gateProOperation(licence: LicenceResult, operation: ProOperation): Result<true, LicenceError> {
	return gateProWork(licence, PRO_OPERATIONS[operation]);
}
