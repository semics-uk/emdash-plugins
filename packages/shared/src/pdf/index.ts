// T016 red phase stub: the writer is not implemented yet.
export type PdfFont = "regular" | "bold" | "italic";
export interface SignatureStrokes {
	v?: number;
	w: number;
	h: number;
	strokes: Array<Array<[number, number] | { x: number; y: number }>>;
}
// biome-ignore lint/suspicious/noExplicitAny: red-phase stub
export type PdfDocument = any;
export function renderPdf(_doc: PdfDocument): Uint8Array {
	throw new Error("renderPdf not implemented");
}
export function measureText(_text: string, _size: number, _font?: PdfFont): number {
	throw new Error("measureText not implemented");
}
export function wrapText(_text: string, _size: number, _maxWidth: number, _font?: PdfFont): string[] {
	throw new Error("wrapText not implemented");
}
export function toWinAnsi(_text: string): string {
	throw new Error("toWinAnsi not implemented");
}
