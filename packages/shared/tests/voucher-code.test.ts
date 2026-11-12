import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
	formatVoucherCode,
	generateVoucherCode,
	normaliseVoucherCode,
	VOUCHER_CODE_ALPHABET,
	voucherCodeId,
} from "../src/index";

interface CodeVector {
	name: string;
	type: "code";
	input: { bytes?: string; text?: string };
	expected: { ok: boolean; code?: string; display?: string; id?: string };
}

const file: { constants: { codeAlphabet: string }; vectors: Array<{ type: string }> } = JSON.parse(
	readFileSync(new URL("../../../docs/protocol/voucher-vectors.json", import.meta.url), "utf8"),
);
const codeVectors = file.vectors.filter((v): v is CodeVector => v.type === "code");
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
const fixed = (bytes: Uint8Array) => () => bytes;

/** A deterministic byte stream (xorshift32), so the tests need no real randomness. */
function seeded(seed: number) {
	let x = seed;
	return (length: number) =>
		Uint8Array.from({ length }, () => {
			x ^= x << 13;
			x ^= x >>> 17;
			x ^= x << 5;
			return x & 0xff;
		});
}

/** Test-side decoding: 16 symbols → 10 bytes, to prove the encoding loses no bits. */
function decode(code: string): Uint8Array {
	const bits = [...code].map((c) => VOUCHER_CODE_ALPHABET.indexOf(c).toString(2).padStart(5, "0")).join("");
	return Uint8Array.from(bits.match(/.{8}/g) ?? [], (b) => Number.parseInt(b, 2));
}

describe("T164 voucher code vectors", () => {
	it("uses the spec's alphabet", () => {
		expect(VOUCHER_CODE_ALPHABET).toBe(file.constants.codeAlphabet);
		expect(VOUCHER_CODE_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
	});

	it.each(codeVectors.map((v) => [v.name, v] as const))("%s", async (_n, v) => {
		if (v.input.bytes !== undefined) {
			expect(generateVoucherCode(fixed(fromHex(v.input.bytes)))).toBe(v.expected.code);
			return;
		}
		const text = v.input.text as string;
		if (!v.expected.ok) {
			expect(normaliseVoucherCode(text)).toBeUndefined();
			expect(formatVoucherCode(text)).toBeUndefined();
			expect(await voucherCodeId(text)).toBeUndefined();
			return;
		}
		expect(normaliseVoucherCode(text)).toBe(v.expected.code);
		expect(formatVoucherCode(text)).toBe(v.expected.display);
		expect(await voucherCodeId(text)).toBe(v.expected.id);
	});
});

describe("T164 voucher code generation", () => {
	it("makes 16-character codes from 80 injected bits and loses none of them", () => {
		const random = seeded(0x9e3779b9);
		for (let i = 0; i < 500; i++) {
			const bytes = random(10);
			const code = generateVoucherCode(fixed(bytes));
			expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
			expect(decode(code)).toEqual(bytes);
		}
	});

	it("draws every symbol uniformly: each 5-bit group maps to exactly one symbol, in every position", () => {
		for (let symbol = 0; symbol < 32; symbol++) {
			// 80 bits made of the same 5-bit group repeated 16 times.
			const bits = symbol.toString(2).padStart(5, "0").repeat(16);
			const bytes = Uint8Array.from(bits.match(/.{8}/g) ?? [], (b) => Number.parseInt(b, 2));
			expect(generateVoucherCode(fixed(bytes))).toBe((VOUCHER_CODE_ALPHABET[symbol] as string).repeat(16));
		}
	});

	it("uses Web Crypto by default and refuses a short random source", () => {
		expect(generateVoucherCode()).toMatch(/^[0-9A-HJKMNP-TV-Z]{16}$/);
		expect(() => generateVoucherCode(() => new Uint8Array(9))).toThrow("10 bytes");
	});
});

describe("T164 voucher code normalisation", () => {
	const random = seeded(42);

	it("round-trips: display, lower case and confusables all normalise back to the code", () => {
		for (let i = 0; i < 200; i++) {
			const code = generateVoucherCode(random);
			const display = formatVoucherCode(code) as string;
			expect(display).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
			expect(normaliseVoucherCode(display)).toBe(code);
			expect(normaliseVoucherCode(display.toLowerCase())).toBe(code);
			const typo = code.replace(/0/g, "O").replace(/1/g, () => (i % 2 ? "I" : "l"));
			expect(normaliseVoucherCode(typo)).toBe(code);
		}
	});

	it("gives the same id across case, grouping and confusable characters", async () => {
		const id = await voucherCodeId("0111-0000-0000-0001");
		expect(id).toMatch(/^[0-9a-f]{64}$/);
		for (const text of ["0111000000000001", "oiil-oooo-oooo-ooo1", "O1IL 0000 0000 000L", " 0111-0000-0000-0001 "]) {
			expect(await voucherCodeId(text)).toBe(id);
		}
		expect(await voucherCodeId("0111-0000-0000-0002")).not.toBe(id);
	});

	it.each([
		["a non-string", 1234],
		["undefined", undefined],
		["15 characters", "0".repeat(15)],
		["17 characters", "0".repeat(17)],
		["the letter U", `U${"0".repeat(15)}`],
		["an underscore", `0000_${"0".repeat(11)}`],
		["a dotless i", `ı${"0".repeat(15)}`],
		["a full-width digit", `０${"0".repeat(15)}`],
		["over 64 characters", `${"0".repeat(16)}${" ".repeat(49)}`],
	])("rejects %s", (_label, text) => {
		expect(normaliseVoucherCode(text)).toBeUndefined();
	});
});
