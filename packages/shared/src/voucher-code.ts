/**
 * Gift voucher codes (docs/protocol/voucher-v1.md §7): 80 random bits as 16 Crockford base32 characters,
 * shown as `XXXX-XXXX-XXXX-XXXX`, typed forgivingly (any case, O for 0, I or L for 1), and stored only as
 * the SHA-256 of the canonical code. Randomness is injected; Web APIs only.
 */
import { type RandomBytes, toHex, webCryptoRandom } from "./bytes";

/** Crockford base32: digits and upper-case letters without I, L, O and U. */
export const VOUCHER_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Random bytes per code: 80 bits. */
export const VOUCHER_CODE_BYTES = 10;
/** Characters in a canonical code. */
export const VOUCHER_CODE_LENGTH = 16;
/** Longest text `normaliseVoucherCode` looks at. */
const MAX_INPUT = 64;

const SEPARATORS = /[ \t\r\n-]/g;
const ASCII_ALNUM = /^[0-9A-Za-z]{16}$/;
const CONFUSABLE: Readonly<Record<string, string>> = { O: "0", I: "1", L: "1" };

/**
 * A new canonical code from 10 random bytes, read as one big-endian 80-bit number in 16 groups of 5 bits.
 * Each group indexes the 32-symbol alphabet, so every symbol is equally likely in every position.
 */
export function generateVoucherCode(random: RandomBytes = webCryptoRandom): string {
	const bytes = random(VOUCHER_CODE_BYTES);
	if (bytes.length !== VOUCHER_CODE_BYTES) throw new Error("Random source must return 10 bytes.");
	let code = "";
	let value = 0;
	let bits = 0;
	for (const byte of bytes) {
		value = ((value << 8) | byte) & 0xfff;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			code += VOUCHER_CODE_ALPHABET[(value >> bits) & 31];
		}
	}
	return code;
}

/**
 * The canonical code for what a person typed, or `undefined` if it is not one: separators (space, tab,
 * CR, LF, `-`) removed, exactly 16 ASCII letters and digits (checked before case folding, so no non-ASCII
 * character can fold into a valid one), upper-cased, O → 0, I and L → 1, and every character in the
 * alphabet (so U is refused).
 */
export function normaliseVoucherCode(text: unknown): string | undefined {
	if (typeof text !== "string" || text.length > MAX_INPUT) return undefined;
	const compact = text.replace(SEPARATORS, "");
	if (!ASCII_ALNUM.test(compact)) return undefined;
	let code = "";
	for (const char of compact.toUpperCase()) code += CONFUSABLE[char] ?? char;
	for (const char of code) if (!VOUCHER_CODE_ALPHABET.includes(char)) return undefined;
	return code;
}

/** The display form `XXXX-XXXX-XXXX-XXXX`, or `undefined` if `text` is not a code. */
export function formatVoucherCode(text: unknown): string | undefined {
	const code = normaliseVoucherCode(text);
	return code && `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}-${code.slice(12)}`;
}

/**
 * The voucher's document id: lowercase hex SHA-256 of the canonical code, so the database never holds a
 * working code. `undefined` if `text` is not a code.
 */
export async function voucherCodeId(text: unknown): Promise<string | undefined> {
	const code = normaliseVoucherCode(text);
	if (code === undefined) return undefined;
	return toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)));
}
