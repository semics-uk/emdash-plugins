import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { PAD_SCRIPT } from "../../src/astro/lib/assets";
import { normaliseStrokes } from "../../src/astro/lib/sign";
import { createPad, padPoint } from "../../src/client/pad.js";

const root = resolve(import.meta.dirname, "../..");

describe("signature pad model (SU-FR-05)", () => {
	it("SU-FR-05 pointer input becomes whole-pixel [x, y] points in pad coordinates, y down", () => {
		const pad = createPad({ w: 600, h: 200 });
		pad.start(10.4, 20.6);
		pad.move(30, 40);
		pad.end();
		expect(pad.value()).toBe('{"v":1,"w":600,"h":200,"strokes":[[[10,21],[30,40]]]}');
	});

	it("SU-FR-05 screen positions map into pad coordinates through the element's box", () => {
		const rect = { left: 100, top: 50, width: 300, height: 100 };
		expect(padPoint({ clientX: 100, clientY: 50 }, rect, { w: 600, h: 200 })).toEqual([0, 0]);
		expect(padPoint({ clientX: 250, clientY: 100 }, rect, { w: 600, h: 200 })).toEqual([300, 100]);
		// Outside the box clamps to its edge.
		expect(padPoint({ clientX: 9999, clientY: -5 }, rect, { w: 600, h: 200 })).toEqual([600, 0]);
	});

	it("SU-FR-05 undo removes the last stroke; clear removes all; both leave an empty value", () => {
		const pad = createPad({ w: 600, h: 200 });
		for (const x of [10, 50, 90]) {
			pad.start(x, 5);
			pad.move(x + 10, 15);
			pad.end();
		}
		expect(pad.strokes()).toHaveLength(3);
		pad.undo();
		expect(pad.strokes().map((s) => s[0]?.[0])).toEqual([10, 50]);
		pad.clear();
		expect(pad.strokes()).toEqual([]);
		expect(pad.value()).toBe("");
		pad.undo();
		expect(pad.value()).toBe("");
	});

	it("SU-FR-05 moves with no stroke started are ignored, and repeated points are dropped", () => {
		const pad = createPad({ w: 600, h: 200 });
		pad.move(5, 5);
		expect(pad.value()).toBe("");
		pad.start(5, 5);
		pad.move(5, 5);
		pad.move(6, 6);
		pad.end();
		expect(pad.strokes()).toEqual([
			[
				[5, 5],
				[6, 6],
			],
		]);
	});

	it("SU-FR-05 a tap leaves a one-point stroke (a dot)", () => {
		const pad = createPad({ w: 600, h: 200 });
		pad.start(5, 5);
		pad.end();
		expect(pad.strokes()).toEqual([[[5, 5]]]);
	});

	it("SU-NFR-04 strokes and points are capped so the output always fits public/submit", () => {
		const pad = createPad({ w: 600, h: 200 });
		for (let s = 0; s < 80; s++) {
			pad.start(s, 0);
			for (let i = 1; i < 100; i++) pad.move(s + (i % 7), i);
			pad.end();
		}
		expect(pad.strokes().length).toBeLessThanOrEqual(64);
		const result = normaliseStrokes(JSON.parse(pad.value()));
		expect(result.ok).toBe(true);
	});

	it("SU-NFR-04 a typical signature stays within 32 KB, raw and normalised", () => {
		const pad = createPad({ w: 600, h: 200 });
		// Four strokes of ~250 points each: a long, scribbled signature.
		for (let s = 0; s < 4; s++) {
			pad.start(20 + s * 120, 100);
			for (let i = 1; i < 250; i++) pad.move(20 + s * 120 + i * 0.4, 100 + Math.round(60 * Math.sin(i / 7 + s)));
			pad.end();
		}
		const raw = pad.value();
		expect(raw.length).toBeLessThan(32 * 1024);
		const result = normaliseStrokes(JSON.parse(raw));
		expect(result.ok).toBe(true);
		if (result.ok) expect(JSON.stringify(result.strokes).length).toBeLessThan(32 * 1024);
	});

	it("SU-NFR-04 no canvas raster is ever submitted: the script never reads pixels", () => {
		expect(PAD_SCRIPT).not.toMatch(/toDataURL|toBlob|getImageData|innerHTML|eval\(/);
		expect(PAD_SCRIPT).toBe(readFileSync(resolve(root, "src/client/pad.js"), "utf8"));
	});
});
