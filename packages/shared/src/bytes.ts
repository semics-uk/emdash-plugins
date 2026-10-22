/**
 * Byte helpers the token, HMAC and pairing modules share, so each core's bundle carries one copy
 * (R42, T118). Web APIs only.
 */

/** Returns `length` cryptographically random bytes. Injected in tests. */
export type RandomBytes = (length: number) => Uint8Array;

/** Web Crypto's random source, the default wherever randomness is injectable. */
export const webCryptoRandom: RandomBytes = (length) => crypto.getRandomValues(new Uint8Array(length));

/** RFC 4648 §5 base64url without padding. */
export function encodeBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Lowercase hex, two digits per byte. */
export function toHex(bytes: Uint8Array | ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** An HMAC-SHA-256 signing key for `secret` (callers check its length first). */
export function hmacSha256Key(secret: Uint8Array): Promise<CryptoKey> {
	return crypto.subtle.importKey("raw", new Uint8Array(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
