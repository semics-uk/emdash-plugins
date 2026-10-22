/**
 * Moves a token from the URL fragment into a POST (EV-FR-12; esign-intent/1 §8.2). E-sign returns
 * the signer to `/booking?ref=…#receipt=<token>`, and the door signing link is
 * `/_events/sign#intent=<token>`: fragments never reach a server or a `Referer`. This script reads
 * the token, removes the fragment with `history.replaceState` (so it is not left in the address bar
 * or history), puts it in the page's hidden form (`form[data-semics-fragment="<name>"]` with an
 * input of that name) and submits it. Without JavaScript nothing is sent.
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

/** The `#<name>=<token>` fragment's token, after clearing the fragment; `null` when there is none. */
export function takeFragmentToken(name: string, loc: FragmentLocation, hist: FragmentHistory): string | null {
	const prefix = `#${name}=`;
	if (!loc.hash.startsWith(prefix)) return null;
	const token = loc.hash.slice(prefix.length);
	if (!TOKEN.test(token)) return null;
	hist.replaceState(null, "", `${loc.pathname}${loc.search}`);
	return token;
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
		const token = input ? takeFragmentToken(name, loc, hist) : null;
		if (!input || token === null) continue;
		input.value = token;
		form.submit();
		submitted += 1;
	}
	return submitted;
}

if (typeof document !== "undefined" && typeof location !== "undefined" && typeof history !== "undefined") {
	submitFragmentForms(document as never, location, history);
}
