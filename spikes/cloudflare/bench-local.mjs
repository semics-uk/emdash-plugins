// Local calibration for S5: the same workloads as the sandboxed probe, timed with process.cpuUsage()
// in Node. Workers clocks do not advance during CPU work, so this is the honest per-render figure;
// the deployed probe gives the enforcement behaviour.
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import { makeStrokes, renderPdf } from "./src/pdf-mini.js";

const strokes = makeStrokes(6, 120);

async function pdflibCreate(pages) {
	const doc = await PDFDocument.create();
	const font = await doc.embedFont(StandardFonts.Helvetica);
	for (let p = 0; p < pages; p++) {
		const page = doc.addPage([595, 842]);
		for (let l = 0; l < 60; l++) {
			page.drawText(`${l + 1}. agreement participant waiver liability event signature consent`, {
				x: 56,
				y: 790 - l * 12,
				size: 10,
				font,
			});
		}
	}
	return doc.save({ useObjectStreams: false });
}

async function pdflibStamp(base) {
	const doc = await PDFDocument.load(base);
	const page = doc.getPages().at(-1);
	for (const s of strokes) {
		for (let i = 1; i < s.length; i++) {
			page.drawLine({
				start: { x: s[i - 1][0], y: s[i - 1][1] },
				end: { x: s[i][0], y: s[i][1] },
				thickness: 0.8,
				color: rgb(0, 0, 0.4),
			});
		}
	}
	return doc.save({ useObjectStreams: false });
}

async function cpuMs(fn, reps) {
	for (let i = 0; i < 5; i++) await fn(); // warm the JIT, like a warm isolate
	const t = process.cpuUsage();
	for (let i = 0; i < reps; i++) await fn();
	const d = process.cpuUsage(t);
	return +((d.user + d.system) / 1000 / reps).toFixed(3);
}

const sha = async (b) => crypto.subtle.digest("SHA-256", b);
const rows = [];
for (const pages of [1, 3, 5]) {
	const base = await renderPdf({ pages });
	rows.push({
		pages,
		miniPlusSha256: await cpuMs(async () => sha(await renderPdf({ pages, strokes })), 200),
		miniCompressed: await cpuMs(() => renderPdf({ pages, strokes, compress: true }), 200),
		pdflibCreate: await cpuMs(() => pdflibCreate(pages), 50),
		pdflibStamp: await cpuMs(() => pdflibStamp(base), 50),
	});
}
console.log(JSON.stringify({ node: process.version, cpuMsPerRender: rows }, null, 2));
