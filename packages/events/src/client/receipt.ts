/**
 * Moves a token from the URL fragment into a POST (EV-FR-12; esign-intent/1 §8.2). E-sign returns
 * the signer to `/booking?ref=…#receipt=<token>`, and the door signing link is
 * `/_events/sign#intent=<token>`: fragments never reach a server or a `Referer`. This script reads
 * the token, removes the fragment with `history.replaceState` (so it is not left in the address bar
 * or history), puts it in the page's hidden form (`form[data-semics-fragment="<name>"]` with an
 * input of that name) and submits it. Without JavaScript nothing is sent. A fragment may carry more
 * tokens after the first (`#intent=<token>&lookup=<token>`, the door link, T119 F5): each goes into the
 * form's input of that name.
 *
 * Self-contained (no imports), like `booking.ts`.
 */

interface FragmentLocation {
	hash: string;
	pathname: string;
	search: string;
}

interface FragmentHistory {
	replaceState(state: unknown, title: string, url: string): void;
}

const TOKEN = /^[A-Za-z0-9_.-]+$/;

/** The tokens of a `#<name>=<token>[&<other>=<token>]` fragment, after clearing it; `null` when there is none. */
export function takeFragment(name: string, loc: FragmentLocation, hist: FragmentHistory): Map<string, string> | null {
	if (!loc.hash.startsWith(`#${name}=`)) return null;
	const tokens = new Map<string, string>();
	for (const part of loc.hash.slice(1).split("&")) {
		const at = part.indexOf("=");
		const token = part.slice(at + 1);
		if (at < 1 || !TOKEN.test(token)) return null;
		tokens.set(part.slice(0, at), token);
	}
	hist.replaceState(null, "", `${loc.pathname}${loc.search}`);
	return tokens;
}

/** The `#<name>=<token>` fragment's token, after clearing the fragment; `null` when there is none. */
export function takeFragmentToken(name: string, loc: FragmentLocation, hist: FragmentHistory): string | null {
	return takeFragment(name, loc, hist)?.get(name) ?? null;
}

interface FragmentForm {
	dataset: { semicsFragment?: string };
	querySelector(selector: string): { value: string } | null;
	submit(): void;
}

/** Fills and submits each fragment form whose token is in the URL. Returns how many it submitted. */
export function submitFragmentForms(
	doc: { querySelectorAll(selector: string): ArrayLike<FragmentForm> },
	loc: FragmentLocation,
	hist: FragmentHistory,
): number {
	let submitted = 0;
	for (const form of Array.from(doc.querySelectorAll("form[data-semics-fragment]"))) {
		const name = form.dataset.semicsFragment ?? "";
		const input = form.querySelector(`input[name="${name}"]`);
		const tokens = input ? takeFragment(name, loc, hist) : null;
		if (!input || tokens === null) continue;
		for (const [key, token] of tokens) {
			const field = key === name ? input : /^\w+$/.test(key) ? form.querySelector(`input[name="${key}"]`) : null;
			if (field) field.value = token;
		}
		form.submit();
		submitted += 1;
	}
	return submitted;
}

if (typeof document !== "undefined" && typeof location !== "undefined" && typeof history !== "undefined") {
	submitFragmentForms(document as never, location, history);
}
