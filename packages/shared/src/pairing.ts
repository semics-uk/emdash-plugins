/**
 * esign-intent/1 pairing strings (`esign1.<clientId>.<secret>`, spec §3) and per-client secrets.
 *
 * Client secrets are derived, never stored (BUILD-PLAN Spike S8): e-sign declares one secret
 * setting, `integrationMasterKey`, and each client's 32-byte HMAC key is
 * `HMAC-SHA256(masterKey, "esign-client/1." + clientId)`. Rotating the master key re-pairs every
 * client.
 *
 * The pairing string is a secret: never log it. Parsers do not trim; settings UIs trim before saving.
 */
import { CLIENT_ID_PATTERN, decodeBase64Url, ESIGN_SECRET_BYTES, encodeBase64Url } from "./hmac";
import { err, ok, type Result } from "./result";
import type { RandomBytes } from "./tokens";

/** Length of a client secret in bytes. */
export const CLIENT_SECRET_BYTES = ESIGN_SECRET_BYTES;
/** Shortest accepted `integrationMasterKey`. */
export const MASTER_KEY_MIN_BYTES = 32;
/** Domain separation for client-secret derivation. */
export const CLIENT_SECRET_DERIVATION_PREFIX = "esign-client/1.";

const PAIRING = /^esign1\.([A-Za-z0-9_-]{4,64})\.([A-Za-z0-9_-]{43})$/;
const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";
const CLIENT_ID_RANDOM_CHARS = 16;
const utf8 = new TextEncoder();
const webCryptoRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

export interface Pairing {
	readonly clientId: string;
	/** The raw 32-byte HMAC key. */
	readonly secret: Uint8Array;
}

/** Parses a pairing string exactly as given (§3): the regex plus canonical base64url of 32 bytes. */
export function parsePairing(value: string): Result<Pairing, "PAIRING_MALFORMED"> {
	const match = typeof value === "string" ? PAIRING.exec(value) : null;
	const secret = match ? decodeBase64Url(match[2] as string) : undefined;
	if (!match || secret?.length !== CLIENT_SECRET_BYTES) return err("PAIRING_MALFORMED");
	return ok({ clientId: match[1] as string, secret });
}

function assertClientId(clientId: string): void {
	if (!CLIENT_ID_PATTERN.test(clientId)) throw new Error("Client id must match the esign-intent/1 clientId grammar.");
}

/** Builds the pairing string shown once when a client is created. */
export function formatPairing(clientId: string, secret: Uint8Array): string {
	assertClientId(clientId);
	if (secret.length !== CLIENT_SECRET_BYTES) throw new Error(`Client secret must be ${CLIENT_SECRET_BYTES} bytes.`);
	return `esign1.${clientId}.${encodeBase64Url(secret)}`;
}

/** `HMAC-SHA256(masterKey, "esign-client/1." + clientId)`: the client's 32-byte secret (Spike S8). */
export async function deriveClientSecret(masterKey: Uint8Array, clientId: string): Promise<Uint8Array> {
	if (masterKey.length < MASTER_KEY_MIN_BYTES)
		throw new Error(`Master key must be at least ${MASTER_KEY_MIN_BYTES} bytes.`);
	assertClientId(clientId);
	const key = await crypto.subtle.importKey(
		"raw",
		new Uint8Array(masterKey),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	return new Uint8Array(await crypto.subtle.sign("HMAC", key, utf8.encode(CLIENT_SECRET_DERIVATION_PREFIX + clientId)));
}

/** A new client id: `cl_` plus 16 random lowercase base32 characters (§3). Never reuse one. */
export function generateClientId(random: RandomBytes = webCryptoRandom): string {
	const bytes = random(CLIENT_ID_RANDOM_CHARS);
	if (bytes.length !== CLIENT_ID_RANDOM_CHARS)
		throw new Error(`Random source must return ${CLIENT_ID_RANDOM_CHARS} bytes.`);
	let id = "cl_";
	// 256 is a multiple of 32, so the low five bits of a uniform byte are uniform.
	for (const byte of bytes) id += BASE32[byte & 31];
	return id;
}
