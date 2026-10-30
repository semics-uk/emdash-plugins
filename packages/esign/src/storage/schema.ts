/**
 * Storage collections and their indexes (ES manifest). `emdash-plugin.jsonc` declares the same
 * indexes; tests/manifest.test.ts fails if the two drift. Every document stays under 512 KiB;
 * signed-PDF and snapshot payloads are chunked (256 KiB base64) by the later tasks that write them.
 */
export const COLLECTIONS = [
	"templates",
	"envelopes",
	"signers",
	"snapshots",
	"artifacts",
	"audit_events",
	"clients",
	"nonces",
	"outbox",
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

type Index = string | readonly string[];

export interface StorageDeclaration {
	readonly indexes: readonly Index[];
	readonly uniqueIndexes?: readonly Index[];
}

export const STORAGE_DECLARATIONS: Readonly<Record<CollectionName, StorageDeclaration>> = {
	templates: { indexes: ["status", "kind", "public"] },
	envelopes: {
		indexes: [
			"status",
			"expiresAt",
			"createdAt",
			"clientId",
			"externalRef",
			"pdfSha256",
			"signerEmail",
			["status", "expiresAt"],
		],
	},
	signers: { indexes: ["envelopeId", "email", "copyTokenHash"], uniqueIndexes: ["tokenHash"] },
	snapshots: { indexes: ["envelopeId"] },
	artifacts: { indexes: ["envelopeId", ["envelopeId", "kind"]] },
	audit_events: { indexes: ["envelopeId", ["envelopeId", "seq"]] },
	// The document id is the client id (T135: no unique index on `clientId`, which envelopes carry too).
	clients: { indexes: ["createdAt"] },
	nonces: { indexes: ["expiresAt"], uniqueIndexes: ["nonce"] },
	// The email outbox (shared T015): mail waiting for the cron drain.
	outbox: { indexes: [["status", "nextAttemptAt"]] },
};
