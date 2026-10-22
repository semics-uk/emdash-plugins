/**
 * Progressive enhancement for `<BookingWidget>` (EU-FR-04, EU-NFR-01..03). The form works without
 * this script (a plain POST to `/_events/checkout`); with it the buyer gets:
 *
 * - a fresh idempotency key when the page loads (so a cached page never shares one), kept for every
 *   resubmit from that page so a retry finds the same booking;
 * - errors next to their fields before anything is sent, with focus on the first one;
 * - a live order total;
 * - a guard against double submits, and the submit button enabled when Turnstile needs scripts.
 *
 * Self-contained (no imports) and budgeted at 15 KB gzipped (`tests/ui/client-bundle.build.test.ts`).
 * Text only ever goes in through `textContent`. `validateBooking` mirrors the server's
 * `validateCheckoutFields` (`src/astro/lib/widget.ts`); a test keeps them identical.
 */

export type BookingField = "occurrence" | "promo" | "tickets" | "name" | "email" | `q:${string}`;

export interface BookingValues {
	name: string;
	email: string;
	lines: number;
	needsOccurrence: boolean;
	occurrenceId: string;
}

// `promo` is only ever set by the server (a refused code); listing it clears that error on a resubmit.
const FIELDS: readonly BookingField[] = ["occurrence", "promo", "tickets", "name", "email"];

/** A custom question's control (Events Pro, T080): its field and whether it has an answer. */
export interface QuestionState {
	field: BookingField;
	required: boolean;
	filled: boolean;
}

/** The required questions without an answer, in form order. Pro's reserve checks them again. */
export function missingAnswers(questions: readonly QuestionState[]): BookingField[] {
	return questions.filter((q) => q.required && !q.filled).map((q) => q.field);
}

function questionStates(form: HTMLFormElement): QuestionState[] {
	return Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-question]"), (el) => ({
		field: (el.dataset.field ?? "") as BookingField,
		required: el.required,
		filled: el instanceof HTMLInputElement && el.type === "checkbox" ? el.checked : el.value.trim() !== "",
	}));
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 32 random bytes as 43 unpadded base64url characters. */
export function freshKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function validateBooking(v: BookingValues): BookingField[] {
	const name = v.name.trim();
	const email = v.email.trim();
	const bad: BookingField[] = [];
	if (v.needsOccurrence && !v.occurrenceId) bad.push("occurrence");
	if (v.lines < 1) bad.push("tickets");
	if (name.length < 1 || name.length > 200) bad.push("name");
	if (email.length > 254 || !EMAIL.test(email)) bad.push("email");
	return bad;
}

export function orderTotalMinor(lines: ReadonlyArray<{ qty: number; priceMinor: number }>): number {
	let total = 0;
	for (const line of lines) if (line.qty > 0) total += line.qty * line.priceMinor;
	return total;
}

/** `free` is the page's word for a zero total (the widget renders it as `data-free`, T102). */
export function formatMinor(minor: number, currency: string, locale: string, free: string): string {
	if (minor === 0) return free;
	try {
		return new Intl.NumberFormat(locale, { style: "currency", currency }).format(minor / 100);
	} catch {
		return `${(minor / 100).toFixed(2)} ${currency}`;
	}
}

const qtyOf = (input: HTMLInputElement) => {
	const n = Number.parseInt(input.value, 10);
	return Number.isFinite(n) ? n : 0;
};

function fieldValue(form: HTMLFormElement, name: string): string {
	const el = form.elements.namedItem(name);
	return el instanceof HTMLInputElement || el instanceof HTMLSelectElement ? el.value : "";
}

function showErrors(form: HTMLFormElement, bad: readonly BookingField[]): void {
	for (const field of [...FIELDS, ...questionStates(form).map((q) => q.field)]) {
		const control = form.querySelector<HTMLElement>(`[data-field="${field}"]`);
		const message = form.querySelector<HTMLElement>(`[data-error-for="${field}"]`);
		if (!control || !message) continue;
		const invalid = bad.includes(field);
		message.textContent = invalid ? (message.dataset.message ?? "") : "";
		if (invalid) control.setAttribute("aria-invalid", "true");
		else control.removeAttribute("aria-invalid");
	}
	const first = bad[0] && form.querySelector<HTMLElement>(`[data-field="${bad[0]}"]`);
	if (!first) return;
	const target = first.matches("fieldset") ? first.querySelector<HTMLElement>("input:not([disabled])") : first;
	target?.focus();
}

function formAlert(form: HTMLFormElement, text: string): void {
	const alert = form.querySelector<HTMLElement>("[data-form-alert]");
	if (!alert) return;
	alert.textContent = text;
	alert.hidden = text === "";
}

/** Wire one booking form. Safe to call twice. */
export function enhance(form: HTMLFormElement): void {
	if (form.dataset.enhanced) return;
	form.dataset.enhanced = "1";
	form.noValidate = true;

	const key = form.elements.namedItem("idempotencyKey");
	if (key instanceof HTMLInputElement) key.value = freshKey();

	// The promo code's Apply button sits inside the widget but belongs to its own form.
	const button = form.querySelector<HTMLButtonElement>('button[type="submit"]:not([data-promo-apply])');
	if (button) button.disabled = false;

	const qtyInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[name^="qty:"]'));
	const total = form.querySelector<HTMLElement>("[data-total]");
	const totalValue = total?.querySelector<HTMLElement>("[data-total-value]");
	const updateTotal = () => {
		if (!total || !totalValue) return;
		const minor = orderTotalMinor(
			qtyInputs.map((i) => ({ qty: qtyOf(i), priceMinor: Number(i.dataset.priceMinor) || 0 })),
		);
		totalValue.textContent = formatMinor(
			minor,
			form.dataset.currency ?? "GBP",
			form.dataset.locale ?? "en-GB",
			form.dataset.free ?? "0",
		);
		total.hidden = false;
	};
	for (const input of qtyInputs) input.addEventListener("input", updateTotal);
	updateTotal();

	form.addEventListener("submit", (event) => {
		if (form.dataset.submitting) {
			event.preventDefault();
			return;
		}
		const bad = [
			...validateBooking({
				name: fieldValue(form, "name"),
				email: fieldValue(form, "email"),
				lines: qtyInputs.filter((i) => qtyOf(i) > 0).length,
				needsOccurrence: fieldValue(form, "needsOccurrence") === "1",
				occurrenceId: fieldValue(form, "occurrenceId"),
			}),
			...missingAnswers(questionStates(form)),
		];
		const needsCheck = form.dataset.turnstile === "on" && fieldValue(form, "cf-turnstile-response") === "";
		if (bad.length > 0 || needsCheck) {
			event.preventDefault();
			formAlert(form, needsCheck && bad.length === 0 ? (form.dataset.turnstileMessage ?? "") : "");
			showErrors(form, bad);
			return;
		}
		formAlert(form, "");
		showErrors(form, []);
		form.dataset.submitting = "1";
		button?.setAttribute("aria-busy", "true");
	});

	// Back/forward cache: the same page (and key) may submit again; let it.
	window.addEventListener("pageshow", (event) => {
		if (!event.persisted) return;
		delete form.dataset.submitting;
		button?.removeAttribute("aria-busy");
	});
}

if (typeof document !== "undefined") {
	for (const form of document.querySelectorAll<HTMLFormElement>("form[data-semics-booking]")) enhance(form);
}
