/**
 * A cron job's state between ticks: one KV value, written back guarded on the revision read (a
 * racing tick's write wins; the next tick redoes the work). One copy for the sweeper and the
 * retention job (R100, T136).
 */
export interface StateKv {
	getVersioned<T>(key: string): Promise<{ value: T; revision: string } | null>;
	compareAndSet(key: string, expectedRevision: string | null, value: unknown): Promise<{ applied: boolean }>;
}

/**
 * The stored state as a copy to change, and `save`: writes it back when it changed (always with
 * `force`) and answers the bridge calls it made (0 or 1). A lost race is ignored.
 */
export function jobState<T extends object>(
	kv: StateKv,
	key: string,
	stored: { value: T; revision: string } | null,
): { value: T; save(force?: boolean): Promise<number> } {
	const before = JSON.stringify(stored?.value ?? {});
	const value = structuredClone(stored?.value ?? {}) as T;
	return {
		value,
		async save(force = false) {
			if (!force && JSON.stringify(value) === before) return 0;
			await kv.compareAndSet(key, stored?.revision ?? null, value).catch(() => undefined);
			return 1;
		},
	};
}
