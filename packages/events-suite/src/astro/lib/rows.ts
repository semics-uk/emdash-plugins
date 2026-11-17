/**
 * `<BookingWithWaiver>`'s attendee rows and summary line (T157). Without JavaScript the first attendee row shows
 * and the others sit in a `<details>` ("Add more people"), so the form still books more than one place. With it,
 * the extra rows show one at a time behind an "Add another person" button, every row that holds a value (a kept,
 * refused form, or a row the server marked) shows, and the summary above Book counts the people and the total.
 * Text only comes from the page's markup. No imports. Runs after keep-form (same script), and follows its
 * `change` events too.
 */

/** Rows to show: the first, and every row up to the last one that holds something. */
export function rowsToShow(filled: readonly boolean[]): number {
	let last = 0;
	for (const [i, has] of filled.entries()) if (has) last = i;
	return last + 1;
}

/** Amounts in the currency's minor unit, as the core keeps them, formatted for people; `free` for nothing. */
export function money(minor: number, currency: string, locale: string, free: string): string {
	if (minor === 0) return free;
	try {
		const format = new Intl.NumberFormat(locale, { style: "currency", currency });
		return format.format(minor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
	} catch {
		return `${(minor / 100).toFixed(2)} ${currency}`;
	}
}

/** "{n} people" from the page's two forms of it. */
export function people(n: number, one: string, many: string): string {
	return (n === 1 ? one : many).replace("{n}", new Intl.NumberFormat().format(n));
}

/** The most of a per-person add-on (T174d) the buyer may order: one each for the places, within its own limit. */
export function addonCap(places: number, own: number): number {
	return Math.max(0, Math.min(own, places));
}

/** What an order costs: a party package (T174f) once for its people, any other ticket type per place. */
export function orderMinor(types: Iterable<{ priceMinor: number; qty: number; package?: boolean }>): number {
	let total = 0;
	for (const t of types) if (t.qty > 0) total += (t.package ? 1 : t.qty) * t.priceMinor;
	return total;
}

/** Fewer than a ticket type's fewest per order (a party package's people, T174g); none is fine. Reserve refuses it too. */
export const tooFew = (qty: number, min: number) => qty > 0 && qty < min;

/** A row someone typed in, ticked, or the server marked as wrong. */
const hasValue = (row: HTMLElement) =>
	row.querySelector('[aria-invalid="true"]') !== null ||
	[...row.querySelectorAll<HTMLInputElement>("input")].some((c) =>
		c.type === "checkbox" ? c.checked : c.type !== "hidden" && c.value.trim() !== "",
	);

/** Wires one booking form. Safe to call twice. */
export function enhanceRows(form: HTMLFormElement): void {
	if (form.dataset.rowsEnhanced) return;
	form.dataset.rowsEnhanced = "1";
	const rows = [...form.querySelectorAll<HTMLElement>("[data-attendee]")];
	const more = form.querySelector<HTMLDetailsElement>("[data-more]");
	const add = form.querySelector<HTMLButtonElement>("[data-add-attendee]");
	const summary = form.querySelector<HTMLElement>("[data-summary]");

	let shown = 1;
	const layout = () => {
		for (const [i, row] of rows.entries()) row.hidden = i >= shown;
		if (add) add.hidden = shown >= rows.length;
	};
	const reveal = () => {
		shown = Math.max(shown, rowsToShow(rows.map(hasValue)));
		layout();
	};
	if (more && add) {
		more.open = true;
		const toggle = more.querySelector("summary");
		if (toggle) toggle.hidden = true;
		more.classList.add("semics-more-js");
		add.addEventListener("click", () => {
			shown = Math.min(rows.length, shown + 1);
			layout();
			rows[shown - 1]?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
			update();
		});
		reveal();
	}

	/** The places the form books now: the plain quantity, or the named attendee rows. */
	const placesChosen = () => {
		const plainQty = form.querySelector<HTMLInputElement>('input[name="qty"]');
		if (plainQty) return Math.max(0, Math.trunc(Number(plainQty.value) || 0));
		return rows.filter(
			(row) => !row.hidden && row.querySelector<HTMLInputElement>('input[name$=".name"]')?.value.trim(),
		).length;
	};
	// A ticket type's fewest and most per order (T174g). The plain quantity takes the chosen type's limits; attendee
	// rows on a type with too few people are refused by the browser before sending, on the type's select (or, with
	// one type, the first row's name).
	const plainType = form.querySelector<HTMLSelectElement>('select[name="ticketTypeId"]');
	const plainQty = form.querySelector<HTMLInputElement>('input[name="qty"]');
	plainType?.addEventListener("change", () => {
		const option = plainType.selectedOptions[0];
		if (!option || !plainQty) return;
		plainQty.min = option.dataset.min ?? "1";
		plainQty.max = option.dataset.max ?? plainQty.max;
		const n = Math.trunc(Number(plainQty.value) || 0);
		plainQty.value = String(Math.min(Math.max(n, Number(plainQty.min)), Number(plainQty.max) || n));
	});
	const checkFewest = () => {
		const types = new Map<string, { n: number; el?: HTMLElement; target?: HTMLInputElement | HTMLSelectElement }>();
		for (const row of rows) {
			const select = row.querySelector("select");
			select?.setCustomValidity("");
			const name = row.querySelector<HTMLInputElement>('input[name$=".name"]');
			name?.setCustomValidity("");
			const type = select?.selectedOptions[0] ?? row.querySelector<HTMLInputElement>('input[type="hidden"][data-min]');
			if (row.hidden || !name?.value.trim() || !type) continue;
			const key = type.getAttribute("value") ?? "";
			const seen = types.get(key) ?? { n: 0, el: type, target: select ?? name };
			seen.n++;
			types.set(key, seen);
		}
		for (const { n, el, target } of types.values())
			if (el && tooFew(n, Number(el.dataset.min))) target?.setCustomValidity(el.dataset.minMessage ?? "");
	};
	// Per-person add-ons (T174d): capped by the places; with no summary they are still capped.
	const addons = [...form.querySelectorAll<HTMLInputElement>("input[data-addon-max]")];
	const update = () => {
		checkFewest();
		const capped = (places: number) => {
			let extra = 0;
			for (const a of addons) {
				const most = addonCap(places, Number(a.dataset.addonMax) || 50);
				a.max = String(most);
				const qty = Math.trunc(Number(a.value) || 0);
				if (qty > most) a.value = String(most);
				extra += Math.min(Math.max(qty, 0), most) * (Number(a.dataset.priceMinor) || 0);
			}
			return extra;
		};
		if (!summary) {
			capped(placesChosen());
			return;
		}
		const { currency = "GBP", locale = "en-GB", one = "", many = "", free = "" } = summary.dataset;
		const single = Number(summary.dataset.priceMinor ?? Number.NaN);
		let count = 0;
		let total = 0;
		// A party package (T174f, `data-package`) costs its price once for its people.
		const typeOf = (option: HTMLElement | undefined | null) =>
			option
				? {
						key: option.getAttribute("value") ?? "",
						priceMinor: Number(option.dataset.priceMinor ?? 0),
						pkg: option.dataset.package !== undefined,
					}
				: { key: "", priceMinor: single, pkg: summary.dataset.package !== undefined };
		if (plainType && plainQty) {
			count = Math.max(1, Math.trunc(Number(plainQty.value) || 1));
			const type = typeOf(plainType.selectedOptions[0]);
			total = orderMinor([{ priceMinor: type.priceMinor, qty: count, package: type.pkg }]);
		} else {
			const optionOf = (row: HTMLElement | undefined) =>
				row?.querySelector<HTMLSelectElement>("select")?.selectedOptions[0];
			const byType = new Map<string, { priceMinor: number; qty: number; package: boolean }>();
			for (const row of rows) {
				const name = row.querySelector<HTMLInputElement>('input[name$=".name"]');
				if (row.hidden || !name?.value.trim()) continue;
				count++;
				const type = typeOf(optionOf(row));
				const seen = byType.get(type.key) ?? { priceMinor: type.priceMinor, qty: 0, package: type.pkg };
				seen.qty++;
				byType.set(type.key, seen);
			}
			total = orderMinor(byType.values());
			// Nobody named yet: what one place (or the package) costs.
			if (count === 0) {
				count = 1;
				total = typeOf(optionOf(rows[0])).priceMinor;
			}
		}
		total += capped(placesChosen());
		const when = summary.querySelector<HTMLElement>("[data-summary-when]");
		const select = form.querySelector<HTMLSelectElement>('select[name="occurrenceId"]');
		const option = select?.value ? select.selectedOptions[0] : undefined;
		if (when) {
			const group = option?.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : "";
			const time =
				(select?.value &&
					form.querySelector(`[data-occurrence="${CSS.escape(select.value)}"] span`)?.textContent?.trim()) ||
				option?.textContent?.trim() ||
				"";
			when.textContent = group && time ? `${group}, ${time}` : time;
			when.hidden = !when.textContent;
		}
		const line = summary.querySelector<HTMLElement>("[data-summary-line]");
		const sum = summary.querySelector<HTMLElement>("[data-summary-total]");
		if (line && sum && count > 0 && Number.isFinite(total)) {
			line.textContent = people(count, one, many);
			sum.textContent = money(total, currency, locale, free);
		}
	};
	form.addEventListener("input", update);
	form.addEventListener("change", () => {
		reveal();
		update();
	});
	update();
}

if (typeof document !== "undefined") {
	for (const form of document.querySelectorAll<HTMLFormElement>("form[data-keep-values]")) enhanceRows(form);
}
