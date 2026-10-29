import { describe, expect, it } from "vitest";

import { stepDay, stepRadio } from "../../src/client/picker";

// Keyboard rules of the picker's client script (T130): roving focus over the month's day buttons
// (a grid) and over a day's times (a radio group), skipping what cannot be chosen.

describe("picker keyboard (T130, a11y)", () => {
	const days = [3, 4, 5, 10, 17, 30];

	it("moves by a day with the arrows and by a week up and down, to the next day that has slots", () => {
		expect(stepDay(days, 4, "ArrowRight", false)).toBe(5);
		expect(stepDay(days, 5, "ArrowRight", false)).toBe(10);
		expect(stepDay(days, 4, "ArrowLeft", false)).toBe(3);
		expect(stepDay(days, 3, "ArrowDown", false)).toBe(10);
		expect(stepDay(days, 10, "ArrowDown", false)).toBe(17);
		expect(stepDay(days, 17, "ArrowUp", false)).toBe(10);
		expect(stepDay(days, 10, "ArrowUp", false)).toBe(3);
		expect(stepDay(days, 5, "Home", false)).toBe(3);
		expect(stepDay(days, 5, "End", false)).toBe(30);
	});

	it("stays put at the month's edges and ignores other keys", () => {
		expect(stepDay(days, 30, "ArrowRight", false)).toBeNull();
		expect(stepDay(days, 3, "ArrowUp", false)).toBeNull();
		expect(stepDay(days, 4, "Tab", false)).toBeNull();
	});

	it("swaps left and right on a right-to-left page", () => {
		expect(stepDay(days, 4, "ArrowLeft", true)).toBe(5);
		expect(stepDay(days, 4, "ArrowRight", true)).toBe(3);
	});

	it("moves through a day's times, wrapping, and never onto a full one", () => {
		const open = [true, false, true, true];
		expect(stepRadio(open, 0, "ArrowDown", false)).toBe(2);
		expect(stepRadio(open, 2, "ArrowRight", false)).toBe(3);
		expect(stepRadio(open, 3, "ArrowRight", false)).toBe(0);
		expect(stepRadio(open, 0, "ArrowUp", false)).toBe(3);
		expect(stepRadio(open, 2, "ArrowLeft", false)).toBe(0);
		expect(stepRadio(open, 2, "ArrowLeft", true)).toBe(3);
		expect(stepRadio([false, false], 0, "ArrowDown", false)).toBeNull();
		expect(stepRadio(open, 0, "Enter", false)).toBeNull();
	});
});
