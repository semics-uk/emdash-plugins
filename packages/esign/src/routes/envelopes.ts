/** Envelope routes (ES-FR-02, ES-FR-03). Red-phase stub. */
import type { RandomBytes } from "@semics-tech/shared";
import type { PluginContext, SandboxedPlugin } from "emdash/plugin";
import type { SignerDoc } from "../domain/envelopes";

type RouteDef = NonNullable<SandboxedPlugin["routes"]>[string];

export interface SignerStore {
	put(id: string, data: SignerDoc): Promise<void>;
}

export async function insertSigner(
	_signers: SignerStore,
	_id: string,
	_build: (tokenHash: string) => SignerDoc,
	_random?: RandomBytes,
): Promise<string> {
	throw new Error("not implemented");
}

export async function fromIntent(_input: unknown, _ctx: PluginContext): Promise<unknown> {
	throw new Error("not implemented");
}

export const ENVELOPE_ROUTES: Record<string, RouteDef> = {};
