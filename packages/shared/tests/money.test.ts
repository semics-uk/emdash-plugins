import { describe, expect, it } from "vitest";
import { formatMoney, fromMinor, minorUnitDigits, toMinor } from "../src/money";

describe("money (EV-NFR-08)", () => {
	it("formats GBP, USD, EUR from minor units", () => {
		expect(formatMoney(1999, "GBP")).toBe("£19.99");
		expect(formatMoney(1999, "USD", "en-US")).toBe("$19.99");
		expect(formatMoney(100000, "EUR", "en-IE")).toBe("€1,000.00");
		expect(formatMoney(5, "GBP")).toBe("£0.05");
		expect(formatMoney(-250, "GBP")).toBe("-£2.50");
	});
	it("treats JPY as zero-decimal", () => {
		expect(minorUnitDigits("JPY")).toBe(0);
		expect(minorUnitDigits("GBP")).toBe(2);
		expect(formatMoney(1500, "JPY", "en-US")).toBe("¥1,500");
	});
	it("handles three-decimal currencies", () => {
		expect(minorUnitDigits("KWD")).toBe(3);
		expect(fromMinor(1234, "KWD")).toBe("1.234");
	});
	it("converts decimal strings to minor units exactly", () => {
		expect(toMinor("19.99", "GBP")).toBe(1999);
		expect(toMinor("0.1", "GBP")).toBe(10);
		expect(toMinor("1500", "JPY")).toBe(1500);
		expect(toMinor("1,000.5", "USD")).toBe(100050);
		expect(toMinor("-2.5", "GBP")).toBe(-250);
	});
	it("rejects excess precision and junk", () => {
		expect(() => toMinor("1.999", "GBP")).toThrow(RangeError);
		expect(() => toMinor("1.5", "JPY")).toThrow(RangeError);
		expect(() => toMinor("abc", "GBP")).toThrow(RangeError);
		expect(() => toMinor("", "GBP")).toThrow(RangeError);
	});
	it("fromMinor round-trips and rejects non-integers", () => {
		expect(fromMinor(1999, "GBP")).toBe("19.99");
		expect(fromMinor(-5, "GBP")).toBe("-0.05");
		expect(fromMinor(1500, "JPY")).toBe("1500");
		expect(() => fromMinor(1.5, "GBP")).toThrow(RangeError);
		expect(() => formatMoney(1.5, "GBP")).toThrow(RangeError);
	});
});
