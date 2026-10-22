import { describe, expect, it } from "vitest";

import { csvCell, toCsv } from "../../src/admin/csv";

describe("CSV export (EV-FR-11)", () => {
	it("EV-FR-11 escapes commas, quotes and newlines", () => {
		expect(csvCell("plain")).toBe("plain");
		expect(csvCell("Lovelace, Ada")).toBe('"Lovelace, Ada"');
		expect(csvCell('say "hi"')).toBe('"say ""hi"""');
		expect(csvCell("two\nlines")).toBe('"two\nlines"');
		expect(csvCell("cr\rhere")).toBe('"cr\rhere"');
	});

	it("EV-FR-11 defuses spreadsheet formulas", () => {
		for (const bad of ["=1+1", "+44 7700", "-2+3", "@SUM(A1)", "\tcmd", "\rcmd"]) {
			const cell = csvCell(bad);
			expect(cell.replace(/^"/, "").startsWith("'"), bad).toBe(true);
		}
		expect(csvCell('=HYPERLINK("http://x","y")')).toBe(`"'=HYPERLINK(""http://x"",""y"")"`);
	});

	it("EV-FR-11 defuses full-width formula signs, which some spreadsheet locales convert (T100, T057 F13)", () => {
		for (const bad of ["＝1+1", "＋44", "－2+3", "＠SUM(A1)"]) expect(csvCell(bad), bad).toBe(`'${bad}`);
	});

	it("EV-FR-11 leaves numbers, booleans and empty values alone", () => {
		expect(csvCell(-5)).toBe("-5");
		expect(csvCell(12)).toBe("12");
		expect(csvCell(true)).toBe("true");
		expect(csvCell(null)).toBe("");
		expect(csvCell(undefined)).toBe("");
	});

	it("EV-FR-11 joins rows with CRLF and ends with a newline", () => {
		expect(toCsv(["a", "b"], [["1", "x,y"]])).toBe('a,b\r\n1,"x,y"\r\n');
	});
});
