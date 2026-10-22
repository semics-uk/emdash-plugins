import { describe, expect, it } from "vitest";
import { column } from "../src/blockkit";
import { encodeBase64Url, hmacSha256Key, toHex, webCryptoRandom } from "../src/bytes";

// R42 (T118): the helpers each core's bundle now carries once.
describe("shared byte helpers (R42)", () => {
	it("R42 toHex gives two lowercase digits per byte, from bytes or a buffer", () => {
		expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
		expect(toHex(new Uint8Array([171, 205]).buffer)).toBe("abcd");
		expect(toHex(new Uint8Array())).toBe("");
	});

	it("R42 encodeBase64Url is unpadded and URL-safe", () => {
		expect(encodeBase64Url(new Uint8Array([251, 255]))).toBe("-_8");
		expect(encodeBase64Url(new Uint8Array([102, 111, 111]))).toBe("Zm9v");
	});

	it("R42 webCryptoRandom returns the requested number of bytes", () => {
		expect(webCryptoRandom(32)).toHaveLength(32);
	});

	it("R42 hmacSha256Key signs the RFC 4231 test case 2", async () => {
		const key = await hmacSha256Key(new TextEncoder().encode("Jefe"));
		const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode("what do ya want for nothing?"));
		expect(toHex(mac)).toBe("5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843");
	});

	it("R42 column leaves out a missing format", () => {
		expect(column("ref", "Reference")).toStrictEqual({ key: "ref", label: "Reference" });
		expect(column("n", "Sold", "number")).toStrictEqual({ key: "n", label: "Sold", format: "number" });
	});
});
