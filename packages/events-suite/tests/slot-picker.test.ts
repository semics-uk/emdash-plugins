import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PICKER_PARAM, pickerParam, usesPicker } from "@semics-tech/emdash-events/astro/lib/picker";
import { describe, expect, it } from "vitest";

// T143: <BookingWithWaiver> books a slot-schedule event through the same day/time picker as Events'
// <BookingWidget> (T130): it reuses the picker's helpers and client script, it does not fork them.

const source = readFileSync(fileURLToPath(new URL("../src/astro/BookingWithWaiver.astro", import.meta.url)), "utf8");
const widget = readFileSync(
	fileURLToPath(new URL("../../events/src/astro/BookingWidget.astro", import.meta.url)),
	"utf8",
);

describe("BookingWithWaiver slot picker (T143)", () => {
	it("EV-FR-17 renders the picker for a slot schedule, not only a date select", () => {
		expect(source).toContain('from "@semics-tech/emdash-events/astro/lib/picker"');
		expect(source).toContain("usesPicker(data");
		expect(source).toContain("data-picker");
		expect(source).toContain('data-testid="booking-picker"');
		expect(source).toContain('import "@semics-tech/emdash-events/client/picker"');
	});

	it("EV-FR-17 keeps the select for dated events, and as the no-JavaScript fallback", () => {
		expect(source).toContain("data-picker-fallback");
		expect(source).toContain('name="occurrenceId"');
		expect(source).toMatch(/!picker && occurrences\.length > 0/);
	});

	it("EV-FR-17 pages by this widget's own parameter and asks `public/event` for that month (T134)", () => {
		expect(source).toContain("pickerParam(eventId)");
		expect(source).toContain("pickerFetchFrom(");
		expect(source).toContain("pickerHref(Astro.url");
		expect(pickerParam("a b")).toBe(`${PICKER_PARAM}.a_b`);
	});

	it("EV-FR-17 uses the same picker rule as the widget (one source of truth)", () => {
		expect(widget).toContain("usesPicker(data");
		expect(usesPicker({ slots: true, occurrences: [] })).toBe(true);
		expect(usesPicker({ occurrences: [{ id: "a", startsAt: "2030-01-01T09:00:00Z", available: 1 }] })).toBe(false);
	});
});
