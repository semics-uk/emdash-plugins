import { MASTER_KEY_MIN_BYTES } from "@semics-tech/shared";

/**
 * `integrationMasterKey` setting → raw key bytes for `deriveClientSecret` (Spike S8): the UTF-8
 * bytes of the trimmed setting, at least 32 bytes. Anything shorter or missing yields `null`, and
 * every client then looks unknown (fail closed). T060 owns the Integrations page that generates
 * the key and may tighten this rule while no client has been paired.
 */
export function masterKeyBytes(value: unknown): Uint8Array | null {
	if (typeof value !== "string") return null;
	const bytes = new TextEncoder().encode(value.trim());
	return bytes.length >= MASTER_KEY_MIN_BYTES ? bytes : null;
}
