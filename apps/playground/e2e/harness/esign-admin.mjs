// E-sign admin credential (T033): the production build has no sign-in bypass, so the freshly seeded
// database gets one admin user and one API token (`ec_pat_...`, scope `admin`). The e2e journey sends
// the envelope with it through the plugin's private routes, exactly as the admin page would. Nothing
// else about e-sign is written here: templates, envelopes, the audit chain and the signed PDF all come
// from the real routes. Runs after `emdash seed`, before the server.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

/** Test-only bearer token. The database it works in is deleted and re-seeded on every run. */
export const ADMIN_TOKEN = `ec_pat_${"E2eAdminToken".repeat(3)}`;

export function applyEsignAdmin(root) {
	const db = new DatabaseSync(resolve(root, "data.db"));
	try {
		db.prepare(
			`INSERT INTO users (id, email, name, role, email_verified) VALUES ('e2e-admin', 'admin@example.com', 'E2E Admin', 50, 1)`,
		).run();
		db.prepare(
			`INSERT INTO _emdash_api_tokens (id, name, token_hash, prefix, user_id, scopes) VALUES (?, ?, ?, ?, 'e2e-admin', ?)`,
		).run(
			"e2e-admin-token",
			"e2e",
			createHash("sha256").update(ADMIN_TOKEN).digest("base64url"),
			ADMIN_TOKEN.slice(0, 11),
			JSON.stringify(["admin"]),
		);
	} finally {
		db.close();
	}
}
