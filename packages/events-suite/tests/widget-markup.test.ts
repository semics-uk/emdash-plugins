import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { waiverCopy } from "../src/astro/lib/form";

// What <BookingWithWaiver> renders, read from source (T157, LMSC staging rc.6).
const source = readFileSync(fileURLToPath(new URL("../src/astro/BookingWithWaiver.astro", import.meta.url)), "utf8");

describe("BookingWithWaiver markup (T157)", () => {
	it("SX-FR-02 labels an attendee's email as needed for adults, not optional", () => {
		// Every adult other than the booker must give one (WAIVER_EMAIL_REQUIRED), and not the booker's own.
		expect(source).not.toContain("Email (optional)");
		expect(source).toContain("Email (needed for adults)");
	});
});

describe("BookingWithWaiver layout (T157)", () => {
	it("SX-FR-02 shows one attendee row; the others wait behind Add another person, in a <details> without JS", () => {
		expect(source).toContain("const [firstRow, ...moreRows] = rows;");
		expect(source).toMatch(/<details class="semics-more" data-more open=\{moreOpen \|\| undefined\}/);
		expect(source).toContain("Add another person");
		// After keep-form, so the rows it filled show.
		expect(source.indexOf('import "./lib/rows"')).toBeGreaterThan(source.indexOf('import "./lib/keep-form"'));
	});

	it("SX-FR-02 puts the summary and price line above Book", () => {
		const summary = source.indexOf('data-testid="waiver-summary"');
		expect(summary).toBeGreaterThan(-1);
		expect(summary).toBeLessThan(source.indexOf('<button type="submit" class="semics-book">Book</button>'));
	});

	it("has no boxed groups: fieldsets lose their border", () => {
		expect(source).toMatch(/\.semics-waiver-widget fieldset \{[^}]*border: 0;/);
	});
});

// T160: Events Pro's `waiverTiming`. Before payment (the default) the widget reads exactly as before; after
// payment its note and numbered steps say pay, then sign. `off` reaches the widget as an event with no waiver.
describe("BookingWithWaiver wording follows the waiver order (T160)", () => {
	it("T160 before payment keeps today's note and adds no steps", () => {
		const before = waiverCopy(false);
		expect(before.note).toBe(
			"List everyone attending, including you if you are going. You sign the waiver now, for yourself and for anyone under 18. Other adults need their own email address: they are sent their waiver to sign.",
		);
		expect(before.steps).toEqual([]);
	});

	it("T160 after payment: book, pay, then sign, in the note and the numbered steps", () => {
		const after = waiverCopy(true);
		expect(after.note).toMatch(/pay first, then sign the waiver/);
		expect(after.note).toMatch(/after you pay/);
		expect(after.steps).toEqual(["Book", "Pay", "Sign the waiver"]);
	});

	it("T160 the widget takes the order from public/event (a paid ticket only) and renders the copy", () => {
		expect(source).toContain("data?.waiverAfter === true");
		expect(source).toContain("waiverCopy(");
		expect(source).toMatch(/<ol class="semics-steps" data-testid="waiver-steps">/);
	});
});
