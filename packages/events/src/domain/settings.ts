/** Plugin settings as an object: one copy of the conversion in the bundle (R42). */
type Entries = Array<{ key: string; value: unknown }>;

export const settingsObject = (entries: Entries): Record<string, unknown> =>
	Object.fromEntries(entries.map((e) => [e.key, e.value]));

/** A numeric setting rounded and clamped to `[min, max]`; `fallback` when it is not a finite number. */
export const clampSetting = (v: unknown, fallback: number, min: number, max = Number.POSITIVE_INFINITY): number =>
	typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

/** One `settings.list` call, as an object. */
export const readSettings = async (deps: { settings: { list(): Promise<Entries> } }) =>
	settingsObject(await deps.settings.list());
