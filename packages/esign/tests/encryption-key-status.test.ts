import { describe, expect, it } from "vitest";
import { encryptionKeyStatus, isEncryptionKeyMissingError } from "../src/domain/encryption-key";

describe("ES encryptionKeyStatus: admin banner when EMDASH_ENCRYPTION_KEY is missing (T020, S8)", () => {
	it.each([undefined, null, "", "   ", ",", " , "])("reports missing for %j and blocks secret saves", (value) => {
		const status = encryptionKeyStatus(value);
		expect(status.state).toBe("missing");
		expect(status.canSaveSecrets).toBe(false);
		expect(status.keyCount).toBe(0);
		expect(status.banner?.tone).toBe("error");
		expect(status.banner?.message).toContain("EMDASH_ENCRYPTION_KEY");
	});

	it("reports ready with no banner for a single key", () => {
		const status = encryptionKeyStatus("abc123");
		expect(status).toEqual({ state: "ready", canSaveSecrets: true, keyCount: 1, banner: null });
	});

	it("counts a comma-separated rotation list and ignores blank entries", () => {
		expect(encryptionKeyStatus("new, old,,").keyCount).toBe(2);
	});

	it("never echoes key material", () => {
		expect(JSON.stringify(encryptionKeyStatus("super-secret-key"))).not.toContain("super-secret-key");
	});

	it("recognises the host's missing-key error code", () => {
		expect(isEncryptionKeyMissingError({ code: "PLUGIN_SETTING_ENCRYPTION_KEY_MISSING" })).toBe(true);
		expect(isEncryptionKeyMissingError(new Error("PLUGIN_SETTING_ENCRYPTION_KEY_MISSING"))).toBe(true);
		expect(isEncryptionKeyMissingError({ code: "OTHER" })).toBe(false);
		expect(isEncryptionKeyMissingError(null)).toBe(false);
		expect(isEncryptionKeyMissingError("PLUGIN_SETTING_ENCRYPTION_KEY_MISSING")).toBe(true);
	});
});
