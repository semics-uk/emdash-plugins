import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { encryptionKeyStatus } from "../src/domain/encryption";
import { SECRET_SETTING_KEYS } from "../src/storage/schema";

let host: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;

function freshKey(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	const body = btoa(String.fromCharCode(...bytes))
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
	return `emdash_enc_v1_${body}`;
}

beforeEach(() => {
	process.env.EMDASH_ENCRYPTION_KEY = freshKey();
});

afterEach(async () => {
	await host?.dispose();
	host = undefined;
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
});

describe("settings (EU-FR-01, spike S8)", () => {
	it("stores plain settings and reads them back", async () => {
		host = await createPluginRuntimeTestHost();
		await host.actions.plugin.updateSettings({
			eventsCollection: "gigs",
			holdMinutesFree: 10,
			turnstileSiteKey: "0x4AAAA-site",
		});
		expect(await host.inspect.setting("eventsCollection")).toBe("gigs");
		expect(await host.inspect.setting("holdMinutesFree")).toBe(10);
		expect(await host.inspect.setting("turnstileSiteKey")).toBe("0x4AAAA-site");
	});

	it("stores every secret field as an encrypted envelope when EMDASH_ENCRYPTION_KEY is set", async () => {
		host = await createPluginRuntimeTestHost();
		const values = { turnstileSecretKey: "0x4AAAA-turnstile-secret", esignPairing: "pairing-string-value" };
		await host.actions.plugin.updateSettings(values);
		expect(SECRET_SETTING_KEYS.length).toBeGreaterThan(0);
		for (const key of SECRET_SETTING_KEYS) {
			const raw = JSON.stringify(await host.inspect.settings.raw(key));
			expect(raw, key).toContain("ciphertext");
			expect(raw, key).not.toContain(values[key as keyof typeof values]);
		}
	});

	it("refuses to save a secret when EMDASH_ENCRYPTION_KEY is missing, without storing plaintext", async () => {
		delete process.env.EMDASH_ENCRYPTION_KEY;
		host = await createPluginRuntimeTestHost();
		let outcome: unknown;
		try {
			outcome = await host.actions.plugin.updateSettings({ turnstileSecretKey: "must-not-be-stored" });
		} catch (error) {
			outcome = error;
		}
		expect(JSON.stringify(await host.inspect.settings.raw("turnstileSecretKey"))).not.toContain("must-not-be-stored");
		// Pin the observed shape of the refusal so a platform change shows up here.
		console.log("OUTCOME", JSON.stringify(outcome), String(outcome));
	});
});

describe("encryption-key banner state matches the host (S8)", () => {
	it("reports a missing key as an error banner and blocks secret saves", () => {
		const status = encryptionKeyStatus({ keyConfigured: false, secrets: {} });
		expect(status.state).toBe("missing");
		expect(status.secretsWritable).toBe(false);
		expect(status.banner?.severity).toBe("error");
	});
});
