/**
 * Money helpers. Amounts are always integers in the currency's minor unit (pence, cents, yen), never
 * floats. The minor-unit exponent comes from `Intl` (GBP 2, JPY 0, KWD 3).
 */

/** Number of minor-unit digits for an ISO 4217 code (GBP 2, JPY 0, KWD 3). */
export function minorUnitDigits(currency: string): number {
	return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
}

function assertInteger(minor: number): void {
	if (!Number.isSafeInteger(minor)) throw new RangeError(`Minor-unit amount must be an integer: ${minor}`);
}

/** Format minor units for display, e.g. `formatMoney(1999, "GBP")` is "£19.99". Default locale en-GB. */
export function formatMoney(minor: number, currency: string, locale = "en-GB"): string {
	assertInteger(minor);
	const digits = minorUnitDigits(currency);
	return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 10 ** digits);
}

/** Exact plain decimal string for minor units: `fromMinor(1999, "GBP")` is "19.99". */
export function fromMinor(minor: number, currency: string): string {
	assertInteger(minor);
	const digits = minorUnitDigits(currency);
	const sign = minor < 0 ? "-" : "";
	const abs = String(Math.abs(minor)).padStart(digits + 1, "0");
	if (digits === 0) return sign + abs;
	return `${sign}${abs.slice(0, -digits)}.${abs.slice(-digits)}`;
}

/**
 * Parse a decimal string ("19.99", "1,000.5") to minor units without float error. Throws RangeError on
 * junk or more fractional digits than the currency allows.
 */
export function toMinor(amount: string, currency: string): number {
	const digits = minorUnitDigits(currency);
	const m = /^(-?)(\d+)(?:\.(\d*))?$/.exec(amount.trim().replace(/,/g, ""));
	if (!m) throw new RangeError(`Not a decimal amount: "${amount}"`);
	const frac = m[3] ?? "";
	if (frac.length > digits) throw new RangeError(`Too many decimal places for ${currency}: "${amount}"`);
	const n = Number(`${m[2]}${frac.padEnd(digits, "0")}`);
	assertInteger(n);
	return m[1] ? -n : n;
}
