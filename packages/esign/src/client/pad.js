// @ts-check
/**
 * The signature pad (SU-FR-05). Progressive enhancement for the `[data-esign-pad-slot]` in
 * <SigningCeremony>: without this script the signer types their name; with it they may also draw.
 *
 * The drawing is kept as vectors, never pixels: `{ v: 1, w, h, strokes }` where each stroke is a
 * list of whole-pixel `[x, y]` points in pad coordinates (y down), written as JSON to the hidden
 * `signatureStrokes` input, followed by a bubbling `input` event. The canvas is only a view of those
 * strokes; nothing reads it back. Pointer events cover mouse, touch and pen. Clear and Undo are real
 * buttons, so they work from the keyboard; the typed name stays the accessible way to sign.
 *
 * Plain JavaScript, no imports: the page inlines this file's exact text and allows it by its
 * SHA-256 in the Content-Security-Policy (src/astro/lib/csp.ts), so it must not be transformed.
 * No HTML is ever built from strings; look comes from classes in the ceremony stylesheet.
 */

/** At most this many strokes and points, so the JSON always fits `public/submit` (64 strokes, 32 KB). */
const MAX_STROKES = 64;
const MAX_POINTS = 1500;

/**
 * @typedef {[number, number]} Point
 * @typedef {{ w: number; h: number }} PadSize
 */

/**
 * A pointer's position in pad coordinates, clamped to the pad.
 * @param {{ clientX: number; clientY: number }} event
 * @param {{ left: number; top: number; width: number; height: number }} rect the canvas's box on screen
 * @param {PadSize} size
 * @returns {Point}
 */
export function padPoint(event, rect, size) {
	const clamp = (/** @type {number} */ n, /** @type {number} */ max) => Math.min(max, Math.max(0, n));
	return [
		Math.round(clamp(((event.clientX - rect.left) * size.w) / rect.width, size.w)),
		Math.round(clamp(((event.clientY - rect.top) * size.h) / rect.height, size.h)),
	];
}

/**
 * The strokes drawn so far.
 * @param {PadSize} size
 */
export function createPad(size) {
	/** @type {Point[][]} */
	const strokes = [];
	/** @type {Point[] | undefined} */
	let current;
	let points = 0;
	const round = (/** @type {number} */ n) => Math.round(n);
	return {
		/** Begins a stroke; ignored once the stroke limit is reached. */
		start(/** @type {number} */ x, /** @type {number} */ y) {
			if (strokes.length >= MAX_STROKES) return;
			current = [[round(x), round(y)]];
			strokes.push(current);
			points++;
		},
		/** Extends the current stroke; repeated points and points over the limit are dropped. */
		move(/** @type {number} */ x, /** @type {number} */ y) {
			if (!current || points >= MAX_POINTS) return;
			const last = current[current.length - 1];
			const point = /** @type {Point} */ ([round(x), round(y)]);
			if (last && last[0] === point[0] && last[1] === point[1]) return;
			current.push(point);
			points++;
		},
		end() {
			current = undefined;
		},
		undo() {
			const removed = strokes.pop();
			if (removed) points -= removed.length;
			current = undefined;
		},
		clear() {
			strokes.length = 0;
			points = 0;
			current = undefined;
		},
		strokes: () => strokes,
		/** The JSON for the hidden input, or "" when nothing is drawn. */
		value: () => (strokes.length === 0 ? "" : JSON.stringify({ v: 1, w: size.w, h: size.h, strokes })),
	};
}

/** The pad's own coordinate space; the canvas scales to its container. */
const SIZE = { w: 600, h: 200 };

/**
 * @param {Document} doc
 * @param {string} tag
 * @param {Record<string, string>} attrs
 * @param {string} [text]
 */
function make(doc, tag, attrs, text) {
	const el = doc.createElement(tag);
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	if (text) el.textContent = text;
	return el;
}

/**
 * Adds a pad to one slot.
 * @param {HTMLElement} slot
 */
function enhanceSlot(slot) {
	const doc = slot.ownerDocument;
	const input = /** @type {HTMLInputElement | null} */ (slot.querySelector('input[name="signatureStrokes"]'));
	if (!input || slot.querySelector("[data-esign-pad]")) return;
	const pad = createPad(SIZE);

	const wrap = make(doc, "div", { class: "semics-pad", "data-esign-pad": "" });
	const canvas = /** @type {HTMLCanvasElement} */ (
		make(doc, "canvas", {
			class: "semics-pad-canvas",
			role: "img",
			"aria-label":
				"Signature drawing area. Optional: draw with a finger, pen or mouse. Typing your name is enough to sign.",
			"data-testid": "sign-pad",
		})
	);
	canvas.width = SIZE.w;
	canvas.height = SIZE.h;
	const undo = make(doc, "button", { type: "button", "data-esign-pad-undo": "" }, "Undo");
	const clear = make(doc, "button", { type: "button", "data-esign-pad-clear": "" }, "Clear");
	const status = make(doc, "p", { class: "semics-note", "aria-live": "polite", "data-esign-pad-status": "" });
	const bar = make(doc, "div", { class: "semics-pad-bar" });
	bar.append(undo, clear);
	const label = make(
		doc,
		"p",
		{ class: "semics-note" },
		"Optional: draw your signature below. Your typed name is still required.",
	);
	wrap.append(label, canvas, bar, status);
	slot.insertBefore(wrap, input);

	const ctx = canvas.getContext("2d");
	const paint = () => {
		const strokes = pad.strokes();
		if (ctx) {
			ctx.clearRect(0, 0, SIZE.w, SIZE.h);
			ctx.lineWidth = 2.5;
			ctx.lineCap = "round";
			ctx.lineJoin = "round";
			ctx.strokeStyle = getComputedStyle(canvas).color;
			ctx.fillStyle = ctx.strokeStyle;
			for (const stroke of strokes) {
				const first = stroke[0];
				if (!first) continue;
				if (stroke.length === 1) {
					ctx.beginPath();
					ctx.arc(first[0], first[1], 1.5, 0, Math.PI * 2);
					ctx.fill();
					continue;
				}
				ctx.beginPath();
				ctx.moveTo(first[0], first[1]);
				for (const p of stroke.slice(1)) ctx.lineTo(p[0], p[1]);
				ctx.stroke();
			}
		}
		const empty = strokes.length === 0;
		undo.toggleAttribute("disabled", empty);
		clear.toggleAttribute("disabled", empty);
	};
	const publish = (/** @type {string} */ note) => {
		paint();
		input.value = pad.value();
		status.textContent = note;
		input.dispatchEvent(new Event("input", { bubbles: true }));
	};

	/** @type {number | undefined} */
	let activePointer;
	const at = (/** @type {PointerEvent} */ e) => padPoint(e, canvas.getBoundingClientRect(), SIZE);
	canvas.addEventListener("pointerdown", (e) => {
		if (activePointer !== undefined || (e.pointerType === "mouse" && e.button !== 0)) return;
		activePointer = e.pointerId;
		try {
			canvas.setPointerCapture(e.pointerId);
		} catch {
			// A pointer the browser no longer tracks: the stroke still draws while it stays over the pad.
		}
		e.preventDefault();
		pad.start(...at(e));
		paint();
	});
	canvas.addEventListener("pointermove", (e) => {
		if (e.pointerId !== activePointer) return;
		e.preventDefault();
		// Coalesced events keep fast strokes smooth.
		for (const c of e.getCoalescedEvents?.() ?? [e]) pad.move(...at(c));
		paint();
	});
	const finish = (/** @type {PointerEvent} */ e) => {
		if (e.pointerId !== activePointer) return;
		activePointer = undefined;
		pad.end();
		publish(`Signature drawn: ${pad.strokes().length} stroke${pad.strokes().length === 1 ? "" : "s"}.`);
	};
	canvas.addEventListener("pointerup", finish);
	canvas.addEventListener("pointercancel", finish);
	undo.addEventListener("click", () => {
		pad.undo();
		publish("Last stroke removed.");
	});
	clear.addEventListener("click", () => {
		pad.clear();
		publish("Signature cleared.");
	});
	paint();
}

/**
 * Wires every pad slot on the page.
 * @param {Document} root
 */
export function enhancePads(root) {
	for (const slot of root.querySelectorAll("[data-esign-pad-slot]")) enhanceSlot(/** @type {HTMLElement} */ (slot));
}

if (typeof document !== "undefined") enhancePads(document);
