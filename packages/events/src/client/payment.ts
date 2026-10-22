/**
 * Polls the booking page while a payment waits for the provider's webhook (EU-FR-09). The access
 * token is an HttpOnly cookie, so the script cannot call the core itself: it re-reads the same
 * page (the cookie goes with it) and looks at the payment region's `data-state`. Polite: growing
 * delays, nothing fetched while the tab is hidden, and it gives up after about 80 seconds; the page
 * then says the buyer will get an email. Without JavaScript the page has a "Check again" link.
 *
 * Self-contained (no imports), no HTML sinks.
 */

/** Waits before each re-read, in order: 3, 5, 8, 13, 21 and 30 seconds (80 s in all). */
export const POLL_DELAYS_MS = [3000, 5000, 8000, 13000, 21000, 30000];

export interface PollDeps {
	/** The region's state now (`data-state`), or `null` when the page could not be read. */
	fetchState(): Promise<string | null>;
	wait(ms: number): Promise<void>;
	isHidden(): boolean;
}

export type PollOutcome = { result: "changed"; state: string } | { result: "gave_up" };

/** Re-reads until the state is no longer `pending`, the schedule runs out, or a read fails. */
export async function pollPayment(deps: PollDeps): Promise<PollOutcome> {
	for (const delay of POLL_DELAYS_MS) {
		await deps.wait(delay);
		// A hidden tab asks nothing; the round is spent.
		if (deps.isHidden()) continue;
		const state = await deps.fetchState();
		if (state === null) return { result: "gave_up" };
		if (state !== "pending") return { result: "changed", state };
	}
	return { result: "gave_up" };
}

async function readState(doc: Document): Promise<string | null> {
	try {
		const res = await fetch(doc.location.href, {
			headers: { accept: "text/html" },
			credentials: "same-origin",
			cache: "no-store",
		});
		if (!res.ok) return null;
		const next = new DOMParser().parseFromString(await res.text(), "text/html");
		return next.querySelector("[data-semics-payment]")?.getAttribute("data-state") ?? null;
	} catch {
		return null;
	}
}

/** Wires the pending region on the page. Returns true when it started polling. */
export function startPaymentPolling(doc: Document = document): boolean {
	const region = doc.querySelector<HTMLElement>("[data-semics-payment][data-state='pending']");
	if (!region) return false;
	const live = region.querySelector<HTMLElement>("[data-semics-payment-live]");
	const slow = region.querySelector<HTMLElement>("[data-semics-payment-slow]");
	const checking = region.querySelector<HTMLElement>("[data-semics-payment-checking]");
	if (checking) checking.hidden = false;
	void pollPayment({
		fetchState: () => readState(doc),
		wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
		isHidden: () => doc.hidden,
	}).then((outcome) => {
		if (checking) checking.hidden = true;
		if (outcome.result === "gave_up") {
			if (slow) slow.hidden = false;
			return;
		}
		// The state moved on: say so in the live region, then show the page afresh (tickets, passes).
		if (live) live.textContent = "Your booking has been updated. Reloading.";
		setTimeout(() => doc.location.reload(), 1500);
	});
	return true;
}

if (typeof document !== "undefined") startPaymentPolling();
