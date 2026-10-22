/**
 * Draws a ticket pass's QR code (EV-FR-11, T082). The matrix comes from the core: Events Pro's
 * `public/booking` adds `qr: { size, bits }` beside each pass's `code` (row-major modules, four per
 * hex digit, most significant first, 1 = dark); Free sends none and the pass shows the code as text
 * only. This only turns a well-formed matrix into an SVG path of horizontal runs; anything else is
 * `null`, so nothing but numbers and path commands ever reaches the markup.
 */
export interface QrPath {
	size: number;
	d: string;
}

/** QR sizes run from 21 (version 1) to 177 (version 40) modules, in steps of 4. */
export function qrPath(qr: unknown): QrPath | null {
	if (!qr || typeof qr !== "object") return null;
	const { size, bits } = qr as { size?: unknown; bits?: unknown };
	if (typeof size !== "number" || !Number.isInteger(size) || size < 21 || size > 177 || (size - 17) % 4 !== 0) {
		return null;
	}
	if (typeof bits !== "string" || bits.length !== Math.ceil((size * size) / 4) || !/^[0-9a-f]+$/.test(bits)) {
		return null;
	}
	const dark = (i: number) => ((Number.parseInt(bits[i >> 2] as string, 16) >> (3 - (i & 3))) & 1) === 1;
	let d = "";
	for (let y = 0; y < size; y++) {
		for (let x = 0; x < size; x++) {
			if (!dark(y * size + x)) continue;
			let run = 1;
			while (x + run < size && dark(y * size + x + run)) run++;
			d += `M${x} ${y}h${run}v1h-${run}z`;
			x += run;
		}
	}
	return { size, d };
}
