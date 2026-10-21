/**
 * Progressive enhancement for the `/verify` page (SU-FR-02). The form works without this script
 * (the visitor pastes the SHA-256); with it, choosing the signed PDF hashes it in the browser and
 * fills the field. The file never leaves the browser. Self-contained, text only through `value`.
 */

/** Lower-case hex SHA-256 of `bytes`. */
export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Wires every `input[data-esign-file]` to the text input named by its `data-target` id. */
export function enhanceVerify(root: Document = document): void {
	for (const file of root.querySelectorAll<HTMLInputElement>("input[data-esign-file]")) {
		file.hidden = false;
		file.addEventListener("change", async () => {
			const target = root.getElementById(file.dataset.target ?? "") as HTMLInputElement | null;
			const chosen = file.files?.[0];
			if (!target || !chosen) return;
			target.value = await sha256Hex(await chosen.arrayBuffer());
		});
	}
}

if (typeof document !== "undefined") enhanceVerify();
