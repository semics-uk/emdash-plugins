export type SecretReadOutcome = "unset" | "readable" | "unreadable";

export interface EncryptionKeyInput {
	keyConfigured?: boolean;
	secrets: Record<string, SecretReadOutcome>;
}

export interface EncryptionKeyStatus {
	state: "ok" | "missing" | "unreadable";
	secretsWritable: boolean;
	banner: { severity: "error" | "warning"; title: string; message: string } | null;
	affected: string[];
}

export function encryptionKeyStatus(_input: EncryptionKeyInput): EncryptionKeyStatus {
	return { state: "ok", secretsWritable: true, banner: null, affected: [] };
}
