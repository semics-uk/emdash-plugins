import { describe, expect, it } from "vitest";

import { encryptionKeyStatus } from "../../src/domain/encryption";

describe("encryptionKeyStatus (EU-FR-01, spike S8)", () => {
	it("is ok, with no banner, when the key is configured and secrets are readable or unset", () => {
		const status = encryptionKeyStatus({
			keyConfigured: true,
			secrets: { turnstileSecretKey: "readable", esignPairing: "unset" },
		});
		expect(status).toEqual({ state: "ok", secretsWritable: true, banner: null, affected: [] });
	});

	it("is ok when nothing is known about the key and no secret is unreadable", () => {
		const status = encryptionKeyStatus({ secrets: { turnstileSecretKey: "unset" } });
		expect(status.state).toBe("ok");
		expect(status.banner).toBeNull();
		expect(status.secretsWritable).toBe(true);
	});

	it("shows an error banner naming EMDASH_ENCRYPTION_KEY when the key is missing", () => {
		const status = encryptionKeyStatus({
			keyConfigured: false,
			secrets: { turnstileSecretKey: "unset", esignPairing: "unset" },
		});
		expect(status.state).toBe("missing");
		expect(status.secretsWritable).toBe(false);
		expect(status.banner?.severity).toBe("error");
		expect(status.banner?.message).toContain("EMDASH_ENCRYPTION_KEY");
		expect(status.banner?.title).toBeTruthy();
		expect(status.affected).toEqual(["esignPairing", "turnstileSecretKey"]);
	});

	it("treats a missing key as the cause even when reads also fail", () => {
		const status = encryptionKeyStatus({ keyConfigured: false, secrets: { turnstileSecretKey: "unreadable" } });
		expect(status.state).toBe("missing");
	});

	it("flags unreadable secrets (wrong or rotated key) and lists only those", () => {
		const status = encryptionKeyStatus({
			keyConfigured: true,
			secrets: { turnstileSecretKey: "unreadable", esignPairing: "readable" },
		});
		expect(status.state).toBe("unreadable");
		expect(status.affected).toEqual(["turnstileSecretKey"]);
		expect(status.banner?.severity).toBe("error");
		expect(status.banner?.message).toContain("EMDASH_ENCRYPTION_KEY");
		expect(status.secretsWritable).toBe(true);
	});

	it("flags unreadable secrets when the key presence is unknown", () => {
		expect(encryptionKeyStatus({ secrets: { esignPairing: "unreadable" } }).state).toBe("unreadable");
	});
});
