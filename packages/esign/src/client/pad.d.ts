// Types for pad.js, which is plain JavaScript so the page can inline its exact text (CSP hash).
export type Point = [number, number];
export interface PadSize {
	w: number;
	h: number;
}

export function padPoint(
	event: { clientX: number; clientY: number },
	rect: { left: number; top: number; width: number; height: number },
	size: PadSize,
): Point;

export function createPad(size: PadSize): {
	start(x: number, y: number): void;
	move(x: number, y: number): void;
	end(): void;
	undo(): void;
	clear(): void;
	strokes(): Point[][];
	value(): string;
};

export function enhancePads(root: Document): void;
