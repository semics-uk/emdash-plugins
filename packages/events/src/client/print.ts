/**
 * "Print or save as PDF" on the booking page (T157): the button stays hidden without JavaScript (it could do
 * nothing there; the browser's own Print still uses the page's print stylesheet). Self-contained; no text.
 */
export function wirePrint(doc: Document, print: () => void): void {
	for (const button of doc.querySelectorAll<HTMLButtonElement>("button[data-print]")) {
		button.hidden = false;
		button.addEventListener("click", () => print());
	}
}

if (typeof document !== "undefined") wirePrint(document, () => window.print());
