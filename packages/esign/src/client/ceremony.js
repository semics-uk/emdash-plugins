// @ts-check
/**
 * Progressive enhancement for <SigningCeremony> (SU-FR-04, SU-FR-07). The ceremony works without
 * this script: the form posts to the page and the server checks it. With it, the signer gets:
 *
 * - Sign disabled until the consent box, the intent box, the typed name and every required field
 *   are complete, with a live note of what is still missing;
 * - a guard against double submits;
 * - after signing, `public/session` polled until the signed PDF is stored, then its download link.
 *
 * Plain JavaScript, no imports: the page inlines this file's exact text and allows it by its
 * SHA-256 in the Content-Security-Policy (src/astro/lib/csp.ts), so it must not be transformed.
 * Text only ever goes in through `textContent`; links only through a checked `href`.
 */

/**
 * @typedef {{ name: string; required: boolean; value: string }} FieldState
 * @typedef {{ typedName: string; consent: boolean; intent: boolean; fields: FieldState[] }} SignState
 */

/**
 * The form controls still to complete before signing, in form order.
 * @param {SignState} state
 * @returns {string[]}
 */
export function missingForSign(state) {
	const missing = state.fields.filter((f) => f.required && f.value.trim() === "").map((f) => f.name);
	if (state.typedName.trim() === "") missing.push("typedName");
	if (!state.consent) missing.push("consent");
	if (!state.intent) missing.push("agree");
	return missing;
}

/**
 * A same-origin URL for the signed PDF, or `undefined` for anything else.
 * @param {unknown} value
 * @param {string} origin
 * @returns {string | undefined}
 */
export function safeDownloadHref(value, origin) {
	if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return undefined;
	try {
		const url = new URL(value, origin);
		return url.origin === origin ? url.href : undefined;
	} catch {
		return undefined;
	}
}

/**
 * The download link in a `public/session` reply once the PDF is ready.
 * @param {unknown} reply the route's JSON envelope (`{ success, data }`)
 * @param {string} origin
 * @returns {string | undefined}
 */
export function pdfLinkFrom(reply, origin) {
	const data =
		reply && typeof reply === "object" && /** @type {{ success?: unknown }} */ (reply).success === true
			? /** @type {{ data?: any }} */ (reply).data
			: undefined;
	if (!data || data.ok === false || data.pdf !== "ready") return undefined;
	return safeDownloadHref(data.download?.url, origin);
}

/** @type {Record<string, string>} */
const NEEDS = {
	typedName: "type your full name",
	consent: "tick the consent box",
	agree: "confirm you intend to sign",
};

/**
 * @param {HTMLFormElement} form
 * @returns {SignState}
 */
function readState(form) {
	const control = (/** @type {string} */ name) =>
		/** @type {HTMLInputElement | null} */ (form.elements.namedItem(name));
	return {
		typedName: control("typedName")?.value ?? "",
		consent: control("consent")?.checked ?? false,
		intent: control("agree")?.checked ?? false,
		fields: [...form.querySelectorAll("[data-esign-field]")].map((el) => {
			const input = /** @type {HTMLInputElement} */ (el);
			return { name: input.name, required: input.required, value: input.value };
		}),
	};
}

/**
 * @param {HTMLFormElement} form
 */
function enhanceSignForm(form) {
	const button = /** @type {HTMLButtonElement | null} */ (form.querySelector("[data-esign-sign]"));
	const note = /** @type {HTMLElement | null} */ (form.querySelector("[data-esign-missing]"));
	if (!button) return;
	let sending = false;
	const update = () => {
		const missing = missingForSign(readState(form));
		button.disabled = sending || missing.length > 0;
		if (!note) return;
		note.hidden = missing.length === 0;
		const labels = missing.map((name) => {
			if (NEEDS[name]) return NEEDS[name];
			const field = /** @type {HTMLElement | null} */ (form.querySelector(`[name="${CSS.escape(name)}"]`));
			return `fill in ${field?.dataset.label ?? "the required fields"}`;
		});
		note.textContent = missing.length ? `To sign, please ${labels.join(", ")}.` : "";
	};
	form.addEventListener("input", update);
	form.addEventListener("change", update);
	form.addEventListener("submit", (event) => {
		if (sending || missingForSign(readState(form)).length > 0) {
			event.preventDefault();
			return;
		}
		sending = true;
		button.setAttribute("aria-busy", "true");
		// After the submit is under way, so the button's own name and value are still sent.
		setTimeout(update, 0);
	});
	update();
}

/**
 * @param {HTMLElement} box
 * @param {{ fetch?: typeof fetch; intervalMs?: number; attempts?: number }} options
 */
function pollForPdf(box, options) {
	const token = box.dataset.token ?? "";
	const plugin = box.dataset.plugin ?? "";
	const target = /** @type {HTMLElement | null} */ (box.querySelector("[data-esign-pdf]"));
	if (!token || !plugin || !target) return;
	const doFetch = options.fetch ?? fetch.bind(globalThis);
	const interval = options.intervalMs ?? 3000;
	let left = options.attempts ?? 60;
	const route = `/_emdash/api/plugins/${encodeURIComponent(plugin)}/public/session`;
	const tick = async () => {
		left--;
		let href;
		try {
			const response = await doFetch(route, {
				method: "POST",
				headers: { "content-type": "application/json", "X-EmDash-Request": "1" },
				body: JSON.stringify({ token }),
				credentials: "same-origin",
				cache: "no-store",
				referrerPolicy: "no-referrer",
			});
			href = pdfLinkFrom(await response.json(), location.origin);
		} catch {
			href = undefined;
		}
		if (href) {
			const link = document.createElement("a");
			link.href = href;
			link.textContent = "Download the signed PDF";
			target.replaceChildren(link);
			return;
		}
		if (left > 0) setTimeout(tick, interval);
		else target.textContent = "The signed PDF is taking longer than usual. Reload this page in a few minutes.";
	};
	void tick();
}

/**
 * Wires every ceremony on the page.
 * @param {Document} root
 * @param {{ fetch?: typeof fetch; intervalMs?: number; attempts?: number }} [options]
 */
export function enhanceCeremony(root, options = {}) {
	for (const form of root.querySelectorAll("form[data-esign-sign-form]"))
		enhanceSignForm(/** @type {HTMLFormElement} */ (form));
	for (const box of root.querySelectorAll("[data-esign-poll]")) pollForPdf(/** @type {HTMLElement} */ (box), options);
}

if (typeof document !== "undefined") enhanceCeremony(document);
