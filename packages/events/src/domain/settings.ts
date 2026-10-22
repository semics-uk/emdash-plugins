/** Plugin settings as an object: one copy of the conversion in the bundle (R42). */
type Entries = Array<{ key: string; value: unknown }>;

export const settingsObject = (entries: Entries): Record<string, unknown> =>
	Object.fromEntries(entries.map((e) => [e.key, e.value]));

/** One `settings.list` call, as an object. */
export const readSettings = async (deps: { settings: { list(): Promise<Entries> } }) =>
	settingsObject(await deps.settings.list());
