import type { PdfDocument, SignatureStrokes } from "../../src/pdf";

/**
 * Typical signed waiver for the T016 tests and the budget fixture: agreement text, two drawn
 * signatures and a certificate of completion with an audit table. Fully deterministic.
 */

const WORDS = [
	"agreement",
	"participant",
	"waiver",
	"liability",
	"event",
	"signature",
	"consent",
	"organiser",
	"risk",
	"activity",
	"acknowledge",
	"release",
	"claims",
	"injury",
	"property",
	"café",
	"naïve",
	"équipe",
];

function sentence(seed: number, words: number): string {
	let x = (seed * 7919 + 104729) >>> 0;
	const out: string[] = [];
	for (let w = 0; w < words; w++) {
		x = (Math.imul(x, 1103515245) + 12345) >>> 0;
		out.push(WORDS[x % WORDS.length] as string);
	}
	const text = out.join(" ");
	return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

/** A signature-pad capture: `count` strokes of `points` points on a 400 x 150 pad (y down). */
export function padStrokes(count: number, points: number, phase = 0): SignatureStrokes {
	const strokes: Array<Array<[number, number]>> = [];
	for (let s = 0; s < count; s++) {
		const stroke: Array<[number, number]> = [];
		for (let p = 0; p < points; p++) {
			const t = p / (points - 1);
			stroke.push([20 + s * 60 + t * 55, 75 + Math.sin(t * Math.PI * 4 + s + phase) * 45]);
		}
		strokes.push(stroke);
	}
	return { v: 1, w: 400, h: 150, strokes };
}

export function waiverDocument(): PdfDocument {
	const blocks: PdfDocument["blocks"] = [
		{ type: "heading", text: "Participation waiver and release of liability", level: 1 },
		{ type: "paragraph", text: "Spring Trail Run 2026 · Ref ENV-0042 · Document SHA-256 9f86d081884c7d65" },
		{ type: "rule" },
	];
	for (let section = 0; section < 12; section++) {
		blocks.push({ type: "heading", text: `${section + 1}. ${sentence(section, 4)}`, level: 2 });
		for (let p = 0; p < 3; p++) blocks.push({ type: "paragraph", text: sentence(section * 10 + p, 70) });
	}
	blocks.push(
		{ type: "heading", text: "Signatures", level: 2 },
		{
			type: "signature",
			label: "Participant",
			strokes: padStrokes(6, 120),
			caption: ["Zoë Ångström", "Signed 2026-10-21 09:14 UTC"],
		},
		{
			type: "signature",
			label: "Parent or guardian",
			strokes: padStrokes(6, 120, 1),
			typedName: "Renée Ångström",
			caption: ["Renée Ångström (guardian)", "Signed 2026-10-21 09:16 UTC"],
		},
		{ type: "pageBreak" },
		{ type: "heading", text: "Certificate of completion", level: 1 },
		{
			type: "table",
			columns: [
				{ header: "Time (UTC)", width: 2 },
				{ header: "Event", width: 2 },
				{ header: "Details", width: 5 },
			],
			rows: Array.from({ length: 10 }, (_, i) => [
				`2026-10-21 09:${String(10 + i).padStart(2, "0")}`,
				["sent", "opened", "consented", "signed", "completed"][i % 5] as string,
				`ip 203.0.113.${i} · hash ${"a1b2c3d4e5f6".repeat(4)}${i}`,
			]),
		},
		{ type: "paragraph", text: "Final hash 2c26b46b68ffc68ff99b453c1d30413413422d706483bfa0f98a5e886266e7ae" },
	);
	return {
		info: { title: "Participation waiver", creationDate: new Date(Date.UTC(2026, 9, 21, 9, 16, 30)) },
		footer: { text: "ENV-0042", pageNumbers: true },
		blocks,
	};
}
