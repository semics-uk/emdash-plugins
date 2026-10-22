/**
 * The ceremony's only script and stylesheet (SU-NFR-02). Both are inlined into the page and
 * allowed by their SHA-256 in its Content-Security-Policy, so the page needs no `'unsafe-inline'`
 * and loads nothing else. They are the package's own constants, never data.
 */
import CEREMONY_SCRIPT from "../../client/ceremony.js?raw";
import PAD_SCRIPT from "../../client/pad.js?raw";
import VERIFY_SCRIPT from "../../client/verify.js?raw";

export { CEREMONY_SCRIPT, PAD_SCRIPT, VERIFY_SCRIPT };

/** The verify page's only stylesheet (hashed into its CSP like the ceremony's). */
export const VERIFY_CSS = `.semics-verify {
	--_fg: var(--esign-fg, #1a1a1a);
	--_muted: var(--esign-muted, #4a4a4a);
	--_bg: var(--esign-bg, #ffffff);
	--_border: var(--esign-border, #6b6b6b);
	--_accent: var(--esign-accent, #0b57d0);
	--_accent-fg: var(--esign-accent-fg, #ffffff);
	--_error: var(--esign-error, #b3261e);
	--_radius: var(--esign-radius, 6px);
	box-sizing: border-box;
	max-width: 44rem;
	color: var(--_fg);
	background: var(--_bg);
	font: 1rem/1.5 system-ui, sans-serif;
	overflow-wrap: anywhere;
}
.semics-verify *, .semics-verify *::before, .semics-verify *::after { box-sizing: inherit; }
.semics-verify input[type="text"] {
	width: 100%;
	max-width: 36rem;
	padding: 0.5rem;
	font: 0.9em ui-monospace, monospace;
	color: var(--_fg);
	background: var(--_bg);
	border: 1px solid var(--_border);
	border-radius: var(--_radius);
}
.semics-verify .semics-drop {
	margin: 1rem 0;
	padding: 1rem;
	border: 2px dashed var(--_border);
	border-radius: var(--_radius);
}
.semics-verify .semics-drop.is-over { border-color: var(--_accent); background: color-mix(in srgb, var(--_accent) 8%, var(--_bg)); }
.semics-verify .semics-note { color: var(--_muted); }
.semics-verify .semics-error { color: var(--_error); font-weight: 600; }
.semics-verify button {
	font: inherit;
	padding: 0.6rem 1.2rem;
	border-radius: var(--_radius);
	border: 1px solid var(--_accent);
	background: var(--_accent);
	color: var(--_accent-fg);
	cursor: pointer;
	min-height: 2.75rem;
}
.semics-verify button:focus-visible, .semics-verify input:focus-visible {
	outline: 3px solid var(--_accent);
	outline-offset: 2px;
}
.semics-verify .semics-result { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--_border); }
`;

export const CEREMONY_CSS = `.semics-ceremony {
	--_fg: var(--esign-fg, #1a1a1a);
	--_muted: var(--esign-muted, #4a4a4a);
	--_bg: var(--esign-bg, #ffffff);
	--_paper: var(--esign-paper, #fafafa);
	--_border: var(--esign-border, #6b6b6b);
	--_accent: var(--esign-accent, #0b57d0);
	--_accent-fg: var(--esign-accent-fg, #ffffff);
	--_error: var(--esign-error, #b3261e);
	--_radius: var(--esign-radius, 6px);
	box-sizing: border-box;
	max-width: 44rem;
	color: var(--_fg);
	background: var(--_bg);
	font: 1rem/1.5 system-ui, sans-serif;
	overflow-wrap: anywhere;
}
.semics-ceremony *, .semics-ceremony *::before, .semics-ceremony *::after { box-sizing: inherit; }
.semics-ceremony .semics-doc {
	border: 1px solid var(--_border);
	border-radius: var(--_radius);
	background: var(--_paper);
	padding: 1rem;
	margin: 0 0 1rem;
}
.semics-ceremony .semics-doc > :first-child { margin-top: 0; }
.semics-ceremony .semics-doc > :last-child { margin-bottom: 0; }
.semics-ceremony pre {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	font: 0.9em/1.4 ui-monospace, monospace;
	margin: 0.75rem 0;
}
.semics-ceremony blockquote { margin: 0.75rem 0; padding-inline-start: 0.75rem; border-inline-start: 3px solid var(--_border); }
.semics-ceremony a { color: var(--_accent); }
.semics-ceremony details { margin: 0 0 1rem; }
.semics-ceremony summary { cursor: pointer; color: var(--_muted); }
.semics-ceremony .semics-hash { font-family: ui-monospace, monospace; font-size: 0.85em; }
.semics-ceremony fieldset { border: 0; padding: 0; margin: 0 0 1rem; min-width: 0; }
.semics-ceremony legend { font-weight: 600; padding: 0; margin-bottom: 0.5rem; }
.semics-ceremony .semics-field { margin: 0 0 0.75rem; }
.semics-ceremony .semics-field > label { display: block; margin-bottom: 0.25rem; }
.semics-ceremony input[type="text"] {
	width: 100%;
	max-width: 28rem;
	padding: 0.5rem;
	font: inherit;
	color: var(--_fg);
	background: var(--_bg);
	border: 1px solid var(--_border);
	border-radius: var(--_radius);
}
.semics-ceremony .semics-check { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0 0 0.75rem; }
.semics-ceremony .semics-check input { margin-top: 0.3rem; flex: none; width: 1.1rem; height: 1.1rem; }
.semics-ceremony [aria-invalid="true"] { outline: 2px solid var(--_error); outline-offset: 1px; }
.semics-ceremony .semics-error { color: var(--_error); font-weight: 600; }
.semics-ceremony .semics-note { color: var(--_muted); }
.semics-ceremony button {
	font: inherit;
	padding: 0.6rem 1.2rem;
	border-radius: var(--_radius);
	border: 1px solid var(--_accent);
	background: var(--_accent);
	color: var(--_accent-fg);
	cursor: pointer;
	min-height: 2.75rem;
}
.semics-ceremony button[data-esign-decline] { background: var(--_bg); color: var(--_accent); }
.semics-ceremony button:disabled { opacity: 0.6; cursor: not-allowed; }
.semics-ceremony button:focus-visible, .semics-ceremony input:focus-visible, .semics-ceremony a:focus-visible, .semics-ceremony summary:focus-visible {
	outline: 3px solid var(--_accent);
	outline-offset: 2px;
}
.semics-ceremony .semics-decline { margin-top: 1.5rem; padding-top: 1rem; border-top: 1px solid var(--_border); }
.semics-ceremony .semics-pad { margin: 0 0 1rem; }
.semics-ceremony .semics-pad-canvas {
	display: block;
	width: 100%;
	max-width: 36rem;
	aspect-ratio: 3 / 1;
	color: var(--_fg);
	background: var(--_bg);
	border: 1px solid var(--_border);
	border-radius: var(--_radius);
	touch-action: none;
	cursor: crosshair;
	user-select: none;
}
.semics-ceremony .semics-pad-bar { display: flex; gap: 0.5rem; margin: 0.5rem 0; }
.semics-ceremony .semics-pad-bar button { background: var(--_bg); color: var(--_accent); }
`;
