/**
 * The integration client table for the protocol routes (from-intent, receipts/lookup,
 * templates/catalog): `getClient` reads the settings and the client document in parallel (2 bridge
 * calls) and derives the client's secret from the master key (S8); nothing secret is stored.
 * `settings()` is what that read saw, so a route can mint a receipt without reading them again.
 */
import { deriveClientSecret, type EsignClient } from "@semics-tech/shared";
import type { PluginContext } from "emdash/plugin";
import { masterKeyBytes } from "../domain/master-key";
import { type ReceiptSource, signReceipt } from "../domain/receipts";
import { stores } from "./envelopes";

function allowlistOf(value: unknown): string[] | undefined {
	return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : undefined;
}

export interface IntegrationClients {
	getClient(cid: string): Promise<EsignClient | undefined>;
	/** The settings `getClient` read (empty before it ran). */
	settings(): Record<string, unknown>;
}

export function integrationClients(ctx: PluginContext): IntegrationClients {
	let settings: Record<string, unknown> = {};
	return {
		settings: () => settings,
		async getClient(cid) {
			const [all, client] = await Promise.all([
				ctx.settings.list(),
				// The document id is the client id (T135): `clients` has no index on `clientId`.
				stores(ctx).clients.get(cid),
			]);
			settings = Object.fromEntries(all.map((s) => [s.key, s.value]));
			const key = masterKeyBytes(settings.integrationMasterKey);
			if (!key || !client) return undefined;
			return {
				secret: await deriveClientSecret(key, cid),
				revoked: client.revokedAt !== undefined && client.revokedAt !== null,
				returnUrlAllowlist: allowlistOf(client.returnUrlAllowlist),
			};
		},
	};
}

/**
 * The receipt for envelope `id` (protocol §5.2), signed with its client's derived secret, or
 * `undefined` when it has none or the master key is missing. No bridge calls: `masterKey` is the
 * `integrationMasterKey` setting the caller already read.
 */
export async function mintReceipt(
	id: string,
	envelope: ReceiptSource,
	masterKey: unknown,
): Promise<string | undefined> {
	const key = masterKeyBytes(masterKey);
	if (!key || !envelope.clientId) return undefined;
	return signReceipt(id, envelope, await deriveClientSecret(key, envelope.clientId));
}
