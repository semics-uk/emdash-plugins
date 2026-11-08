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

	const update = () => {
		if (!summary) return;
		const { currency = "GBP", locale = "en-GB", one = "", many = "", free = "" } = summary.dataset;
		const single = Number(summary.dataset.priceMinor ?? Number.NaN);
		let count = 0;
		let total = 0;
		const plainType = form.querySelector<HTMLSelectElement>('select[name="ticketTypeId"]');
		const plainQty = form.querySelector<HTMLInputElement>('input[name="qty"]');
		if (plainType && plainQty) {
			count = Math.max(1, Math.trunc(Number(plainQty.value) || 1));
			total = count * Number(plainType.selectedOptions[0]?.dataset.priceMinor ?? 0);
		} else {
			const price = (row: HTMLElement | undefined) => {
				const type = row?.querySelector<HTMLSelectElement>("select");
				return type ? Number(type.selectedOptions[0]?.dataset.priceMinor ?? 0) : single;
			};
			for (const row of rows) {
				const name = row.querySelector<HTMLInputElement>('input[name$=".name"]');
				if (row.hidden || !name?.value.trim()) continue;
				count++;
				total += price(row);
			}
			// Nobody named yet: what one place costs.
			if (count === 0) {
				count = 1;
				total = price(rows[0]);
			}
		}
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
