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
