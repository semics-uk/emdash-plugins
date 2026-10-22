// @ts-check
/**
 * Progressive enhancement for the `/verify` page (SU-FR-02, ES-US-6). The form works without this
 * script (the visitor pastes the SHA-256). With it, choosing or dropping the signed PDF hashes it
 * in the browser with WebCrypto, fills the fingerprint field and submits the form. Only the hash
 * is ever posted: the file control has no `name`, and this script has no network code at all.
 *
 * Plain JavaScript, no imports: the page inlines this file's exact text and allows it by its
 * SHA-256 in the Content-Security-Policy (src/astro/lib/csp.ts), so it must not be transformed.
 * Text only ever goes in through `textContent` and `value`.
 */

/**
 * Lower-case hex SHA-256 of `bytes`.
 * @param {ArrayBuffer} bytes
 * @returns {Promise<string>}
 */
export async function sha256Hex(bytes) {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Hashes `chosen` into `target`, says what happened in `status`, and submits `form`.
 * @param {{ name?: string; arrayBuffer(): Promise<ArrayBuffer> }} chosen
 * @param {{ value: string }} target
 * @param {{ textContent: string | null } | null} status
 * @param {{ requestSubmit(): void } | null} form
 * @param {Record<string, string>} m the page's messages (keys without `verify.`, T102)
 */
async function hashInto(chosen, target, status, form, m) {
	/** @param {string} key @param {string} [name] */
	const say = (key, name = "") => {
		if (status) status.textContent = (m[key] ?? key).replace("{name}", name);
	};
	say("reading");
	let hash;
	try {
		hash = await sha256Hex(await chosen.arrayBuffer());
	} catch {
		say("unreadable");
		return;
	}
	target.value = hash;
	say("done", chosen.name || (m.theFile ?? "theFile"));
	form?.requestSubmit();
}

/**
 * Wires every `input[data-esign-file]` (and each `[data-esign-drop]` zone) to the text input named
 * by the file input's `data-target` id.
 * @param {Pick<Document, "querySelectorAll" | "getElementById">} root
 */
export function enhanceVerify(root) {
	for (const file of /** @type {NodeListOf<HTMLInputElement>} */ (root.querySelectorAll("input[data-esign-file]"))) {
		file.hidden = false;
		const target = /** @type {HTMLInputElement | null} */ (root.getElementById(file.dataset.target ?? ""));
		const status = root.getElementById(file.dataset.status ?? "");
		const form = file.closest("form");
		if (!target) continue;
		/** @type {Record<string, string>} */
		let m = {};
		try {
			m = JSON.parse(file.dataset.messages ?? "{}");
		} catch {
			// No messages: the status line shows their keys.
		}
		file.addEventListener("change", async () => {
			const chosen = file.files?.[0];
			if (chosen) await hashInto(chosen, target, status, form, m);
		});
		for (const zone of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll("[data-esign-drop]"))) {
			zone.addEventListener("dragover", (event) => {
				event.preventDefault();
				zone.classList.toggle("is-over", true);
			});
			zone.addEventListener("dragleave", () => zone.classList.toggle("is-over", false));
			zone.addEventListener("drop", async (event) => {
				event.preventDefault();
				zone.classList.toggle("is-over", false);
				const dropped = /** @type {DragEvent} */ (event).dataTransfer?.files?.[0];
				if (dropped) await hashInto(dropped, target, status, form, m);
			});
		}
	}
}

if (typeof document !== "undefined") enhanceVerify(document);
