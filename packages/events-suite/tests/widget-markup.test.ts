import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
