// Probe-only stand-in for the T016 dependency-free PDF writer: Helvetica text pages (no font
// embedding), a signature drawn as vector strokes on the last page, a classic xref table, and an
// optional FlateDecode content stream through CompressionStream. Loaded as a module inside the
// Worker Loader isolate so its CPU is charged to the sandboxed plugin, as T016's writer will be.

const enc = new TextEncoder();

function esc(s) {
	return s.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// Deterministic pseudo-random text so every run renders the same bytes.
function makeLine(seed, i) {
	const words = [
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
	];
	let x = (seed * 7919 + i * 104729) >>> 0;
	const out = [];
	for (let w = 0; w < 12; w++) {
		x = (x * 1103515245 + 12345) >>> 0;
		out.push(words[x % words.length]);
	}
	return `${i + 1}. ${out.join(" ")}.`;
}

function wrap(text, maxChars) {
	const lines = [];
	let line = "";
	for (const word of text.split(" ")) {
		if (`${line} ${word}`.trim().length > maxChars) {
			lines.push(line.trim());
			line = word;
		} else line += ` ${word}`;
	}
	if (line.trim()) lines.push(line.trim());
	return lines;
}

function pageContent(pageIndex, linesPerPage, strokes) {
	const ops = ["BT", "/F1 10 Tf", "12 TL", "56 790 Td"];
	let rendered = 0;
	for (let i = 0; rendered < linesPerPage; i++) {
		for (const l of wrap(makeLine(pageIndex, i), 95)) {
			if (rendered >= linesPerPage) break;
			ops.push(`(${esc(l)}) Tj T*`);
			rendered++;
		}
	}
	ops.push("ET");
	if (strokes) {
		ops.push("0.8 w 1 J 1 j 0 0 0.4 RG");
		for (const stroke of strokes) {
			ops.push(`${stroke[0][0].toFixed(2)} ${stroke[0][1].toFixed(2)} m`);
			for (let p = 1; p < stroke.length; p++) {
				ops.push(`${stroke[p][0].toFixed(2)} ${stroke[p][1].toFixed(2)} l`);
			}
			ops.push("S");
		}
	}
	return ops.join("\n");
}

// A signature-pad style capture: `count` strokes of `points` points each.
export function makeStrokes(count, points) {
	const strokes = [];
	for (let s = 0; s < count; s++) {
		const stroke = [];
		for (let p = 0; p < points; p++) {
			const t = p / points;
			stroke.push([60 + s * 40 + t * 35, 90 + Math.sin(t * Math.PI * 4 + s) * 18]);
		}
		strokes.push(stroke);
	}
	return strokes;
}

async function deflate(bytes) {
	const cs = new CompressionStream("deflate");
	const w = cs.writable.getWriter();
	w.write(bytes);
	w.close();
	return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}

export async function renderPdf({ pages, linesPerPage = 60, strokes = null, compress = false }) {
	const objects = []; // index i => object number i + 1
	const add = (body) => {
		objects.push(body);
		return objects.length;
	};
	const catalog = add(null);
	const pagesObj = add(null);
	const font = add(enc.encode("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
	const kids = [];
	for (let p = 0; p < pages; p++) {
		const raw = enc.encode(pageContent(p, linesPerPage, p === pages - 1 ? strokes : null));
		const data = compress ? await deflate(raw) : raw;
		const head = enc.encode(`<< /Length ${data.length}${compress ? " /Filter /FlateDecode" : ""} >>\nstream\n`);
		const tail = enc.encode("\nendstream");
		const stream = new Uint8Array(head.length + data.length + tail.length);
		stream.set(head, 0);
		stream.set(data, head.length);
		stream.set(tail, head.length + data.length);
		const contents = add(stream);
		kids.push(
			add(
				enc.encode(
					`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${contents} 0 R >>`,
				),
			),
		);
	}
	objects[catalog - 1] = enc.encode(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
	objects[pagesObj - 1] = enc.encode(
		`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`,
	);

	const chunks = [enc.encode("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n")];
	let offset = chunks[0].length;
	const offsets = [];
	for (let i = 0; i < objects.length; i++) {
		offsets.push(offset);
		const head = enc.encode(`${i + 1} 0 obj\n`);
		const tail = enc.encode("\nendobj\n");
		chunks.push(head, objects[i], tail);
		offset += head.length + objects[i].length + tail.length;
	}
	let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
	for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
	xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${offset}\n%%EOF\n`;
	chunks.push(enc.encode(xref));
	const total = chunks.reduce((n, c) => n + c.length, 0);
	const out = new Uint8Array(total);
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}
