// Sandboxed probe for pdf-lib cost (S5 fallback question). Separate isolate so the mini writer's
// numbers are not charged pdf-lib's module parse.
import { PDFDocument, StandardFonts, rgb } from "./pdf-lib.js";

function strokes(count, points) {
	const out = [];
	for (let s = 0; s < count; s++) {
		const stroke = [];
		for (let p = 0; p < points; p++) {
			const t = p / points;
			stroke.push([60 + s * 40 + t * 35, 90 + Math.sin(t * Math.PI * 4 + s) * 18]);
		}
		out.push(stroke);
	}
	return out;
}

function b64ToBytes(b64) {
	const bin = atob(b64);
	const out = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
	return out;
}

async function create(pages) {
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

async function stamp(baseBytes, strokeCount, strokePoints) {
	const doc = await PDFDocument.load(baseBytes);
	const page = doc.getPages().at(-1);
	for (const s of strokes(strokeCount, strokePoints)) {
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

async function run(body) {
	const reps = body.reps ?? 1;
	let size = 0;
	if (body.op === "pdflib-create") {
		for (let r = 0; r < reps; r++) size = (await create(body.pages)).length;
	} else if (body.op === "pdflib-stamp") {
		const base = b64ToBytes(body.base);
		for (let r = 0; r < reps; r++) {
			size = (await stamp(base, body.strokeCount ?? 6, body.strokePoints ?? 120)).length;
		}
	} else return { error: `unknown op ${body.op}` };
	return { engine: body.op, pages: body.pages, reps, size };
}

// Same I/O-bracketed timer as plugin.js (Workers clocks only advance on I/O).
async function timed(env, work, samples = 3) {
	const out = { baselineMs: [], workMs: [] };
	for (let i = 0; i < samples; i++) {
		await env.BRIDGE.noop(0);
		let t0 = Date.now();
		await env.BRIDGE.noop(1);
		out.baselineMs.push(Date.now() - t0);
		t0 = Date.now();
		out.last = await work();
		await env.BRIDGE.noop(2);
		out.workMs.push(Date.now() - t0);
	}
	return out;
}

export default {
	async fetch(request, env) {
		const body = await request.json();
		if (body.op === "ping") return Response.json({ pong: true });
		if (body.timed) return Response.json(await timed(env, () => run(body), body.samples));
		return Response.json(await run(body));
	},
};
