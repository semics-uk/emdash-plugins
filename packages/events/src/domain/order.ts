/**
 * Sort comparators shared across the core, so the bundle carries each once (R99, T136).
 */

/** Ascending order of strings (code-unit order, as `<` compares). */
export const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Ticket types in display order: `sort`, then name. */
export const ticketOrder = (a: { sort: number; name: string }, b: { sort: number; name: string }): number =>
	a.sort - b.sort || cmp(a.name, b.name);
