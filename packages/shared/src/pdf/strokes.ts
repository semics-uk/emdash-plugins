import { num } from "./writer";

/**
 * Signature-pad capture (T031): `strokes` are point lists in a `w` x `h` pad space with y growing
 * downwards (points may also be normalised to 0-1 with `w = h = 1`). Points are `[x, y]` (extra
 * elements such as pressure are ignored) or `{ x, y }`.
 */
export interface SignatureStrokes {
	v?: number;
	w: number;
	h: number;
	strokes: Array<Array<[number, number] | { x: number; y: number }>>;
}

/** Upper bound on points drawn per signature, so hostile input cannot blow the CPU budget. */
export const MAX_SIGNATURE_POINTS = 20_000;

type Point = [number, number];

function toPoint(p: unknown): Point | undefined {
	let x: unknown;
	let y: unknown;
	if (Array.isArray(p)) [x, y] = p;
	else if (p !== null && typeof p === "object") ({ x, y } = p as { x?: unknown; y?: unknown });
	return typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)
		? [x, y]
		: undefined;
}

/** Valid strokes only: non-finite or malformed points dropped, empty strokes removed, capped in size. */
export function cleanStrokes(input: unknown): Point[][] {
	const list = (input as { strokes?: unknown } | null)?.strokes;
	if (!Array.isArray(list)) return [];
	const out: Point[][] = [];
	let budget = MAX_SIGNATURE_POINTS;
	for (const raw of list) {
		if (!Array.isArray(raw) || budget <= 0) continue;
		const stroke: Point[] = [];
		for (const p of raw) {
			const point = toPoint(p);
			if (point && budget > 0) {
				stroke.push(point);
				budget--;
			}
		}
		if (stroke.length > 0) out.push(stroke);
	}
	return out;
}

export interface Box {
	/** Left edge, PDF coordinates. */
	x: number;
	/** Top edge, PDF coordinates (y up). */
	top: number;
	width: number;
	height: number;
}

/**
 * Content-stream operators that draw the strokes as round-capped vector paths fitted inside `box`
 * (aspect ratio kept, left-aligned, centred vertically, clamped to the pad). A one-point stroke becomes a dot. Returns
 * an empty string when there is nothing to draw.
 */
export function strokeOps(input: unknown, box: Box): string {
	const strokes = cleanStrokes(input);
	if (strokes.length === 0) return "";
	const pad = input as { w?: unknown; h?: unknown };
	let w = typeof pad.w === "number" && Number.isFinite(pad.w) && pad.w > 0 ? pad.w : 0;
	let h = typeof pad.h === "number" && Number.isFinite(pad.h) && pad.h > 0 ? pad.h : 0;
	if (w === 0 || h === 0) {
		// No usable pad size: use the extent of the points themselves.
		for (const stroke of strokes) {
			for (const [x, y] of stroke) {
				w = Math.max(w, x);
				h = Math.max(h, y);
			}
		}
		w = Math.max(w, 1);
		h = Math.max(h, 1);
	}
	const scale = Math.min(box.width / w, box.height / h);
	const offsetY = (box.height - h * scale) / 2;
	// Points outside the pad are pulled onto its edge, so ink never leaves the box.
	const px = (x: number) => num(box.x + Math.min(w, Math.max(0, x)) * scale);
	const py = (y: number) => num(box.top - offsetY - Math.min(h, Math.max(0, y)) * scale);
	const ops = ["q 0.05 0.1 0.45 RG 1.2 w 1 J 1 j"];
	for (const stroke of strokes) {
		const [first] = stroke as [Point];
		ops.push(`${px(first[0])} ${py(first[1])} m`);
		if (stroke.length === 1) ops.push(`${px(first[0])} ${py(first[1])} l`);
		for (let i = 1; i < stroke.length; i++) {
			const [x, y] = stroke[i] as Point;
			ops.push(`${px(x)} ${py(y)} l`);
		}
		ops.push("S");
	}
	ops.push("Q");
	return ops.join("\n");
}
