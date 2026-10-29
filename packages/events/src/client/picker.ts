/**
 * The booking form's day-then-time picker (T130, EV-FR-17). `<BookingWidget>` renders the month
 * calendar (`[data-picker]`, hidden) beside a plain `<select name="occurrenceId">` grouped by day
 * (`[data-picker-fallback]`), so the form works without this script. With it, the calendar replaces the
 * select: a day button (`data-day`) shows that day's times (`[data-times]`, a radio group of buttons,
 * full ones `aria-disabled`), and choosing a time sets the select, which is what the form posts.
 *
 * Keyboard: roving tabindex over the day buttons (arrows by a day, up and down by a week, Home/End; to
 * the next day that has slots), and over a day's times (arrows, wrapping, skipping full ones). Text
 * only comes from the page's markup; this script writes none. Self-contained (no imports).
 */

const DELTAS: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 7, ArrowUp: -7 };

/** The day (of `days`, ascending) a key moves to from `current`, or `null` to stay. */
export function stepDay(days: readonly number[], current: number, key: string, rtl: boolean): number | null {
	// i18n-ignore
	if (key === "Home") return days[0] ?? null;
	// i18n-ignore
	if (key === "End") return days[days.length - 1] ?? null;
	let delta = DELTAS[key];
	if (delta === undefined) return null;
	if (rtl && Math.abs(delta) === 1) delta = -delta;
	const target = current + delta;
	const found = delta > 0 ? days.find((d) => d >= target) : [...days].reverse().find((d) => d <= target);
	return found ?? null;
}

/** The time (index into `open`) a key moves to from `current`, wrapping and skipping full ones. */
export function stepRadio(open: readonly boolean[], current: number, key: string, rtl: boolean): number | null {
	let delta = DELTAS[key];
	if (delta === undefined) return null;
	delta = Math.sign(delta);
	if (rtl && (key === "ArrowLeft" || key === "ArrowRight")) delta = -delta;
	const n = open.length;
	for (let i = 1; i <= n; i++) {
		const at = (((current + delta * i) % n) + n) % n;
		if (open[at] && at !== current) return at;
	}
	return null;
}

const isRtl = (el: Element) => getComputedStyle(el).direction === "rtl";

/** Wire one picker. Safe to call twice. */
export function enhancePicker(picker: HTMLElement): void {
	if (picker.dataset.enhanced) return;
	const form = picker.closest("form");
	const select = form?.querySelector<HTMLSelectElement>('select[name="occurrenceId"]');
	if (!form || !select) return;
	picker.dataset.enhanced = "1";
	const fallback = form.querySelector<HTMLElement>("[data-picker-fallback]");
	if (fallback) fallback.hidden = true;
	select.required = false;
	picker.hidden = false;

	const dayButtons = Array.from(picker.querySelectorAll<HTMLButtonElement>("button[data-day]"));
	const groups = Array.from(picker.querySelectorAll<HTMLElement>("[data-times]"));
	const hint = picker.querySelector<HTMLElement>("[data-picker-hint]");
	const radios = (group: HTMLElement) => Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
	const isOpen = (b: HTMLElement) => b.getAttribute("aria-disabled") !== "true";

	const setSelect = (value: string) => {
		if (select.value === value) return;
		select.value = value;
		select.dispatchEvent(new Event("change", { bubbles: true }));
	};

	const chooseTime = (button: HTMLButtonElement, focus: boolean) => {
		if (!isOpen(button)) return;
		for (const group of groups) {
			for (const r of radios(group)) {
				const on = r === button;
				r.setAttribute("aria-checked", on ? "true" : "false");
				if (group.contains(button)) r.tabIndex = on ? 0 : -1;
			}
		}
		if (focus) button.focus();
		setSelect(button.dataset.occurrence ?? "");
	};

	const showDay = (button: HTMLButtonElement, focus: boolean) => {
		const key = button.dataset.day ?? "";
		for (const b of dayButtons) {
			b.setAttribute("aria-pressed", b === button ? "true" : "false");
			b.tabIndex = b === button ? 0 : -1;
		}
		if (focus) button.focus();
		let keep = false;
		for (const group of groups) {
			const mine = group.dataset.times === key;
			group.hidden = !mine;
			if (mine) keep = radios(group).some((r) => r.dataset.occurrence === select.value);
		}
		if (hint) hint.hidden = true;
		if (!keep) {
			for (const group of groups) for (const r of radios(group)) r.setAttribute("aria-checked", "false");
			setSelect("");
		}
	};

	for (const button of dayButtons) {
		button.addEventListener("click", () => showDay(button, false));
		button.addEventListener("keydown", (event) => {
			const days = dayButtons.map((b) => Number(b.dataset.n));
			const to = stepDay(days, Number(button.dataset.n), event.key, isRtl(picker));
			if (to === null) return;
			event.preventDefault();
			const target = dayButtons.find((b) => Number(b.dataset.n) === to);
			if (target) {
				for (const b of dayButtons) b.tabIndex = b === target ? 0 : -1;
				target.focus();
			}
		});
	}
	for (const group of groups) {
		const list = radios(group);
		for (const [i, radio] of list.entries()) {
			radio.addEventListener("click", () => chooseTime(radio, false));
			radio.addEventListener("keydown", (event) => {
				const to = stepRadio(list.map(isOpen), i, event.key, isRtl(picker));
				if (to === null) return;
				event.preventDefault();
				const target = list[to];
				if (target) chooseTime(target, true);
			});
		}
	}

	// A value the browser kept (back/forward, a failed submit): show its day and time.
	const kept =
		select.value && picker.querySelector<HTMLButtonElement>(`[data-occurrence="${CSS.escape(select.value)}"]`);
	const keptDay =
		kept && dayButtons.find((b) => b.dataset.day === kept.closest<HTMLElement>("[data-times]")?.dataset.times);
	if (kept && keptDay) {
		showDay(keptDay, false);
		chooseTime(kept, false);
	}
}

if (typeof document !== "undefined") {
	for (const picker of document.querySelectorAll<HTMLElement>("[data-picker]")) enhancePicker(picker);
}
