/**
 * Encryption-key banner state for the admin pages (spike S8).
 *
 * Secret settings are encrypted with `EMDASH_ENCRYPTION_KEY`. A sandboxed plugin cannot read the
 * environment, so the caller reports what it can observe: whether the host said a key is
 * configured (when it knows), and for each secret setting whether it is unset, readable, or
 * stored but unreadable (wrong, rotated or lost key). Pure: no I/O.
 */

export type SecretReadOutcome = "unset" | "readable" | "unreadable";

export interface EncryptionKeyInput {
	/** `false` when the host reports no key; leave undefined when that is not known. */
	keyConfigured?: boolean;
	secrets: Readonly<Record<string, SecretReadOutcome>>;
}

export interface EncryptionKeyBanner {
	severity: "error";
	title: string;
	message: string;
}

export interface EncryptionKeyStatus {
	state: "ok" | "missing" | "unreadable";
	/** Whether a secret setting can be saved right now. */
	secretsWritable: boolean;
	banner: EncryptionKeyBanner | null;
	/** Secret settings the banner is about, sorted. */
	affected: string[];
}

const KEY = "EMDASH_ENCRYPTION_KEY";

export function encryptionKeyStatus(input: EncryptionKeyInput): EncryptionKeyStatus {
	const names = Object.keys(input.secrets).sort();

	if (input.keyConfigured === false) {
		return {
			state: "missing",
			secretsWritable: false,
			affected: names,
			banner: {
				severity: "error",
				title: "Encryption key missing",
				message: `Secret settings (such as the Turnstile secret key and the e-sign pairing string) cannot be saved until ${KEY} is set on the site. Set it, restart the site, then save the settings again.`,
			},
		};
	}

	const unreadable = names.filter((name) => input.secrets[name] === "unreadable");
	if (unreadable.length > 0) {
		return {
			state: "unreadable",
			secretsWritable: true,
			affected: unreadable,
			banner: {
				severity: "error",
				title: "Saved secrets cannot be read",
				message: `${unreadable.join(", ")} cannot be decrypted. ${KEY} is missing, changed or does not include the key the value was saved with. Restore the key, or enter the value again.`,
			},
		};
	}

	return { state: "ok", secretsWritable: true, banner: null, affected: [] };
}
