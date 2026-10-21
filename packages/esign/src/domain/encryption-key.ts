/** Admin banner state for the host's `EMDASH_ENCRYPTION_KEY` (S8). Never echoes key material. */
export interface EncryptionKeyStatus {
	state: "ready" | "missing";
	canSaveSecrets: boolean;
	keyCount: number;
	banner: { tone: "error"; message: string } | null;
}

export function encryptionKeyStatus(value: string | null | undefined): EncryptionKeyStatus {
	const keyCount = (value ?? "").split(",").filter((key) => key.trim() !== "").length;
	if (keyCount === 0) {
		return {
			state: "missing",
			canSaveSecrets: false,
			keyCount: 0,
			banner: {
				tone: "error",
				message:
					"EMDASH_ENCRYPTION_KEY is not set, so secret settings (the integration master key and the Turnstile secret) cannot be saved. Set it in the site environment and restart.",
			},
		};
	}
	return { state: "ready", canSaveSecrets: true, keyCount, banner: null };
}

export function isEncryptionKeyMissingError(error: unknown): boolean {
	const code = "PLUGIN_SETTING_ENCRYPTION_KEY_MISSING";
	if (typeof error === "string") return error.includes(code);
	if (error instanceof Error) return error.message.includes(code);
	if (typeof error === "object" && error !== null) return (error as { code?: unknown }).code === code;
	return false;
}
