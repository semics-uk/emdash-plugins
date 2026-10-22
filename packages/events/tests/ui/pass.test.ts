import { describe, expect, it } from "vitest";
import { qrPath } from "../../src/astro/lib/pass";

/** A matrix in the shape Pro's `public/booking` sends: row-major, four modules per hex digit. */
function matrix(dark: (x: number, y: number) => boolean, size = 21) {
	let bits = "";
	for (let i = 0; i < size * size; i += 4) {
		let nibble = 0;
		for (let j = 0; j < 4; j++) {
			const k = i + j;
			nibble = (nibble << 1) | (k < size * size && dark(k % size, Math.floor(k / size)) ? 1 : 0);
		}
		bits += nibble.toString(16);
	}
	return { size, bits };
}

describe("ticket pass QR (EV-FR-11, T082)", () => {
	it("EV-FR-11 draws the dark modules as one path of horizontal runs", () => {
		const view = qrPath(matrix((x, y) => (x === 0 && y === 0) || y === 20));
		expect(view).toEqual({ size: 21, d: "M0 0h1v1h-1zM0 20h21v1h-21z" });
	});

	it("EV-FR-11 the path is made of numbers and path commands only", () => {
		const view = qrPath(matrix((x, y) => (x * y) % 3 === 0, 25));
		expect(view?.d).toMatch(/^(M\d+ \d+h\d+v1h-\d+z)+$/);
	});

	it("EV-FR-11 anything that is not a well-formed matrix draws nothing (Free passes have no QR)", () => {
		for (const bad of [
			undefined,
			null,
			"0f",
			{ size: 21 },
			{ size: 20, bits: "0".repeat(100) },
			{ size: 21, bits: "0".repeat(110) },
			{ size: 21, bits: `${"0".repeat(110)}g` },
			{ size: 21, bits: `${"0".repeat(110)}"` },
			{ size: 181, bits: "0".repeat(Math.ceil((181 * 181) / 4)) },
		]) {
			expect(qrPath(bad), JSON.stringify(bad)).toBeNull();
		}
	});
});
