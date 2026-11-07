/**
 * Forgets what the suite's booking form kept for a refusal (`keep-form.ts` in the suite): a person who reaches the
 * booking page has got past the form, and on a shared device their details must not linger. Self-contained.
 */
export function forgetKeptForms(storage: Pick<Storage, "length" | "key" | "removeItem">): void {
	for (let i = storage.length - 1; i >= 0; i--) {
		const key = storage.key(i);
		if (key?.startsWith("semics-waiver-form:")) storage.removeItem(key);
	}
}

try {
	if (typeof document !== "undefined") forgetKeptForms(sessionStorage);
} catch {
	// Storage is blocked: nothing was kept either.
}
