// E-sign fixture (T032): one completed envelope whose signed PDF has a known SHA-256, written straight
// into the freshly seeded database (no signing ceremony or PDF job is run). It lets the e2e suite drop
// the "signed" PDF on /verify and open the stable "get my signed copy" page with the emailed token.
// The audit chain is not populated, so the verify page reports the chain as not verifying; the
// matching itself (`pdfSha256`) is what these tests check. Runs after `emdash seed`, before the server.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const PLUGIN_ID = "semics-esign";

/** The bytes the test drops on /verify. Not a real signed PDF: only its hash matters here. */
export const SIGNED_PDF = Buffer.from("%PDF-1.4\n% e2e fixture for the verify page\n%%EOF\n", "utf8");
export const SIGNED_PDF_SHA256 = createHash("sha256").update(SIGNED_PDF).digest("hex");
/** The signing token a completion email would carry (43 characters, base64url). */
export const SIGNED_COPY_TOKEN = "Sg".repeat(21) + "x";

export function applyEsignFixtures(root) {
	const db = new DatabaseSync(resolve(root, "data.db"));
	const now = new Date().toISOString();
	const put = db.prepare(
		`INSERT INTO _plugin_storage (plugin_id, collection, id, data, revision, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
	);
	const envelopeId = "e2e-completed";
	const envelope = {
		title: "Venue hire agreement",
		templateId: "e2e",
		templateVersion: 1,
		status: "completed",
		routing: "parallel",
		delivery: "link",
		signer: { name: "Ada Lovelace", email: "ada@example.com", as: "self" },
		fieldValues: {},
		signerIds: [`${envelopeId}:s1`],
		docSha256: "d".repeat(64),
		snapshot: null,
		expiresAt: null,
		sentAt: now,
		completedAt: now,
		finalHash: "f".repeat(64),
		pdfSha256: SIGNED_PDF_SHA256,
		pdf: { ids: [], bytes: SIGNED_PDF.length },
		piiSalt: "e2e",
		createdAt: now,
		updatedAt: now,
	};
	const signer = {
		envelopeId,
		order: 1,
		role: "signer",
		name: "Ada Lovelace",
		email: "ada@example.com",
		as: "self",
		status: "signed",
		tokenHash: createHash("sha256").update(SIGNED_COPY_TOKEN).digest("hex"),
		createdAt: now,
		signedAt: now,
	};
	try {
		put.run(PLUGIN_ID, "envelopes", envelopeId, JSON.stringify(envelope), crypto.randomUUID(), now, now);
		put.run(PLUGIN_ID, "signers", `${envelopeId}:s1`, JSON.stringify(signer), crypto.randomUUID(), now, now);
	} finally {
		db.close();
	}
}
