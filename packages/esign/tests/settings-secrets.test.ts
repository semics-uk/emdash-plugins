import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let host: PluginRuntimeTestHost | undefined;
const originalKey = process.env.EMDASH_ENCRYPTION_KEY;

function restoreKey() {
	if (originalKey === undefined) delete process.env.EMDASH_ENCRYPTION_KEY;
	else process.env.EMDASH_ENCRYPTION_KEY = originalKey;
}

beforeEach(restoreKey);

afterEach(async () => {
	await host?.dispose();
	host = undefined;
	restoreKey();
});

const PLAINTEXT_SECRET = "turnstile-secret-plaintext-0123456789";
const PLAINTEXT_MASTER = "master-key-plaintext-0123456789abcdef";

describe("ES settings: secret fields are encrypted at rest (T020, S8)", () => {
	it("stores plain settings as given and secret settings as an encrypted envelope", async () => {
		process.env.EMDASH_ENCRYPTION_KEY = "esign-test-encryption-key-0123456789abcdef";
		host = await createPluginRuntimeTestHost();
		const result = await host.actions.plugin.updateSettings({
			senderName: "Acme Legal",
			expiryDays: 14,
			turnstileSecretKey: PLAINTEXT_SECRET,
			integrationMasterKey: PLAINTEXT_MASTER,
		});
		expect(result.success).toBe(true);

		expect(await host.inspect.setting("senderName")).toBe("Acme Legal");
		expect(await host.inspect.setting("expiryDays")).toBe(14);

		for (const [key, plaintext] of [
			["turnstileSecretKey", PLAINTEXT_SECRET],
			["integrationMasterKey", PLAINTEXT_MASTER],
		] as const) {
			const raw = await host.inspect.settings.raw(key);
			expect(raw, key).toMatchObject({ $emdash: "plugin-setting" });
			expect(JSON.stringify(raw), key).not.toContain(plaintext);
			// The sandbox reads the decrypted value back through ctx.settings.
			expect(await host.inspect.setting(key), key).toBe(plaintext);
		}
	});

	it("refuses to save a secret without EMDASH_ENCRYPTION_KEY (the admin banner explains why)", async () => {
		delete process.env.EMDASH_ENCRYPTION_KEY;
		host = await createPluginRuntimeTestHost();
		const result = await host.actions.plugin.updateSettings({ integrationMasterKey: PLAINTEXT_MASTER });
		expect(result.success).toBe(false);
		expect(JSON.stringify(result)).toContain("PLUGIN_SETTING_ENCRYPTION_KEY_MISSING");
		expect(JSON.stringify(await host.inspect.settings.raw("integrationMasterKey"))).not.toContain(PLAINTEXT_MASTER);
	});
});
