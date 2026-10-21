/**
 * Dependency-free, deterministic PDF writer (T016, ES-FR-07): Helvetica text with wrapping, headings,
 * tables (the audit certificate) and drawn signatures as vector paths. The same input always gives
 * the same bytes: no clock, no randomness, no compression, no document ID; a creation date is only
 * written when the caller passes one. Runs in the sandboxed core (R25): about 0.5 ms for a 5-page
 * waiver with strokes on Cloudflare (T110, S5).
 */

import { FONTS } from "./fonts";
import { layoutPages, type PdfBlock, type PdfFooter, type PdfPageSetup, pageGeometry } from "./layout";
import { num, pdfDate, serialize, stream, textString } from "./writer";

export { measureText, type PdfFont, toWinAnsi } from "./fonts";
export type { PdfAlign, PdfBlock, PdfFooter, PdfMargins, PdfPageSetup } from "./layout";
export { MAX_SIGNATURE_POINTS, type SignatureStrokes } from "./strokes";
export { wrapText } from "./wrap";

export interface PdfInfo {
	title?: string;
	author?: string;
	subject?: string;
	keywords?: string;
	creator?: string;
	/** Injected, never read from the clock; omitted when absent. */
	creationDate?: Date;
}

export interface PdfDocument {
	info?: PdfInfo;
	page?: PdfPageSetup;
	footer?: PdfFooter;
	blocks: PdfBlock[];
}

const PRODUCER = "semics pdf";

function infoDict(info: PdfInfo | undefined): string {
	const entries: string[] = [];
	const add = (key: string, value: unknown) => {
		if (typeof value === "string" && value !== "") entries.push(`/${key} ${textString(value)}`);
	};
	add("Title", info?.title);
	add("Author", info?.author);
	add("Subject", info?.subject);
	add("Keywords", info?.keywords);
	add("Creator", info?.creator);
	add("Producer", PRODUCER);
	if (info?.creationDate instanceof Date) {
		const date = pdfDate(info.creationDate);
		if (date) entries.push(`/CreationDate (${date})`);
	}
	return `<< ${entries.join(" ")} >>`;
}

/** Render `doc` to PDF 1.7 bytes. */
export function renderPdf(doc: PdfDocument): Uint8Array<ArrayBuffer> {
	const geometry = pageGeometry(doc.page);
	const contents = layoutPages(geometry, doc.blocks, doc.footer);

	// Object numbers: 1 catalog, 2 page tree, 3 info, fonts, then a content stream + page per page.
	const CATALOG = 1;
	const PAGES = 2;
	const INFO = 3;
	const objects: string[] = [`<< /Type /Catalog /Pages ${PAGES} 0 R >>`, "", infoDict(doc.info)];
	const fontRefs = FONTS.map((f) => {
		objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /${f.baseFont} /Encoding /WinAnsiEncoding >>`);
		return `/${f.resource} ${objects.length} 0 R`;
	}).join(" ");
	const mediaBox = `[0 0 ${num(geometry.width)} ${num(geometry.height)}]`;
	const kids: string[] = [];
	for (const content of contents) {
		objects.push(stream(content));
		const contentRef = objects.length;
		objects.push(
			`<< /Type /Page /Parent ${PAGES} 0 R /MediaBox ${mediaBox} /Resources << /Font << ${fontRefs} >> >> /Contents ${contentRef} 0 R >>`,
		);
		kids.push(`${objects.length} 0 R`);
	}
	objects[PAGES - 1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
	return serialize(objects, CATALOG, INFO);
}
