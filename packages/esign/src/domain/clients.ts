import {
	deriveClientSecret,
	encodeBase64Url,
	formatPairing,
	generateClientId,
	MASTER_KEY_MIN_BYTES,
	type RandomBytes,
} from "@semics-tech/shared";

import { masterKeyBytes } from "./master-key";

/**
 * Integration clients (T060, ES-FR-12, Spike S8).
 *
 * A client's secret is never stored: it is `HMAC-SHA256(integrationMasterKey, "esign-client/1." +
 * clientId)`, re-derived when the pairing string is built. The pairing string exists only in the
 * response to the create action and cannot be rebuilt for display (no page reads a secret out);
 * revoking sets `revokedAt`, which `from-intent` already treats as CLIENT_REVOKED.
 *
 * Master-key rule (decision, T060): `masterKeyBytes` stays as T022 wrote it (UTF-8 of the trimmed
 * setting, at least 32 bytes, else fail closed). The generated key is 32 CSPRNG bytes as base64url
 * (43 characters). The settings save refuses a typed key under 32 bytes, saves it trimmed, and the
 * "generate" action only runs while no key is set, because changing the key re-pairs every client.
 */
export interface ClientDoc {
	name: string;
	clientId: string;
	createdAt: string;
	lastUsedAt: string | null;
	revokedAt: string | null;
	returnUrlAllowlist: string[];
}

export interface ClientStore {
	put(id: string, data: ClientDoc): Promise<void>;
	updateIf(
		id: string,
		args: { where: Record<string, unknown>; set?: Partial<ClientDoc> },
	): Promise<{ applied: true; data: ClientDoc } | { applied: false }>;
	query(o: {
		orderBy?: Record<string, "asc" | "desc">;
		limit?: number;
	}): Promise<{ items: Array<{ id: string; data: ClientDoc }> }>;
}

export const MAX_CLIENTS = 100;
const MAX_ALLOWLIST_ENTRIES = 10;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const webRandom: RandomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

/** A fresh master key: 32 random bytes, base64url (43 characters, which `masterKeyBytes` accepts). */
export function generateMasterKey(random: RandomBytes = webRandom): string {
	return encodeBase64Url(random(MASTER_KEY_MIN_BYTES));
}

/** True when a typed master key would be refused (after trimming). */
export const masterKeyTooShort = (value: string): boolean => masterKeyBytes(value) === null;

/** Protocol §7: absolute https (http only for loopback) URLs, no userinfo, query or fragment. */
export function parseAllowlist(text: string): { ok: true; entries: string[] } | { ok: false; entry: string } {
	const entries: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		const raw = line.trim();
		if (raw === "") continue;
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			return { ok: false, entry: raw };
		}
		const schemeOk = url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK.has(url.hostname));
		if (!schemeOk || url.username || url.password || raw.includes("#") || raw.includes("?")) {
			return { ok: false, entry: raw };
		}
		entries.push(url.href);
	}
	return entries.length > MAX_ALLOWLIST_ENTRIES ? { ok: false, entry: "too many entries" } : { ok: true, entries };
}

export type CreateClientResult =
	| { ok: true; client: ClientDoc; pairing: string }
	| { ok: false; code: "MASTER_KEY_MISSING" | "NAME_REQUIRED" };

/**
 * Creates a client and returns its pairing string. The caller shows `pairing` once and drops it.
 * One write; the caller passes the master key it already read.
 */
export async function createClient(
	store: ClientStore,
	input: { name: string; returnUrlAllowlist: string[]; masterKey: unknown },
	deps: { now: string; random?: RandomBytes },
): Promise<CreateClientResult> {
	const key = masterKeyBytes(input.masterKey);
	if (!key) return { ok: false, code: "MASTER_KEY_MISSING" };
	const name = input.name.trim();
	if (name === "" || name.length > 100) return { ok: false, code: "NAME_REQUIRED" };
	const clientId = generateClientId(deps.random);
	const client: ClientDoc = {
		name,
		clientId,
		createdAt: deps.now,
		lastUsedAt: null,
		revokedAt: null,
		returnUrlAllowlist: input.returnUrlAllowlist,
	};
	await store.put(clientId, client);
	const pairing = formatPairing(clientId, await deriveClientSecret(key, clientId));
	return { ok: true, client, pairing };
}

/** Sets `revokedAt` once; revoking an already revoked client keeps the first time. */
export async function revokeClient(store: ClientStore, clientId: string, now: string): Promise<boolean> {
	const done = await store.updateIf(clientId, { where: { revokedAt: null }, set: { revokedAt: now } });
	return done.applied;
}

export async function listClients(store: ClientStore): Promise<ClientDoc[]> {
	const page = await store.query({ orderBy: { createdAt: "desc" }, limit: MAX_CLIENTS });
	return page.items.map((i) => i.data);
}
