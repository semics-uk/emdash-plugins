// T145 stub (red).
export interface PairContext {
	locals: unknown;
	url: URL;
	settings: {
		read(pluginId: string): Promise<Response>;
		write(pluginId: string, values: Record<string, unknown>): Promise<Response>;
	};
}
export async function pairingStatus(_ctx: PairContext, _ids: unknown): Promise<unknown> {
	return { state: "error" };
}
export async function pairAction(_ctx: PairContext, _ids: unknown, _action: unknown): Promise<unknown> {
	return { state: "error" };
}
