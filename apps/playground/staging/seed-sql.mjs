// The staging D1 seed (T111): the same database the local e2e server starts from (emdash seed of
// seed/seed.json plus the booking fixtures), as one SQL file for `wrangler d1 execute --file`.
//
//   node staging/seed-sql.mjs <out.sql>
//
// Every run replaces the tables, so each nightly starts from the same state. The local e2e admin token
// is public (it is in esign-admin.mjs) and is never shipped: with STAGING_ADMIN_TOKEN set, its row
// carries that token's hash instead; without it the site has no API token at all.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import { applyEsignAdmin } from "../e2e/harness/esign-admin.mjs";
import { applyBookingFixtures } from "../e2e/harness/fixtures.mjs";

const E2E_TOKEN_ID = "e2e-admin-token";

const quoteId = (name) => `"${name.replaceAll('"', '""')}"`;

function literal(value) {
	if (value === null || value === undefined) return "NULL";
	if (typeof value === "number" || typeof value === "bigint") return String(value);
	if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
	return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * The database at `file` as SQL statements D1 accepts: no transactions, no `sqlite_*` or `_cf_*`
 * objects, FTS5 shadow tables left to their virtual table. Order: drop, create tables, rows,
 * then indexes and triggers (so no trigger fires on the copied rows).
 * @param {string} file
 * @param {{ adminToken?: string }} [options]
 */
export function dumpSql(file, options = {}) {
	const db = new DatabaseSync(file, { readOnly: true });
	try {
		const objects = db
			.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY rowid")
			.all()
			.filter((o) => !o.name.startsWith("sqlite_") && !o.tbl_name.startsWith("_cf_"));
		const virtual = objects.filter((o) => o.type === "table" && /^CREATE VIRTUAL TABLE/i.test(o.sql));
		const shadow = (name) => virtual.some((v) => name.startsWith(`${v.name}_`));
		const tables = objects.filter((o) => o.type === "table" && !shadow(o.name));
		const out = ["PRAGMA defer_foreign_keys = true;"];
		for (const t of [...tables].reverse()) out.push(`DROP TABLE IF EXISTS ${quoteId(t.name)};`);
		for (const t of tables) out.push(`${t.sql};`);
		for (const t of tables) {
			const isVirtual = virtual.includes(t);
			const rows = db.prepare(`SELECT ${isVirtual ? "rowid AS __rowid, " : ""}* FROM ${quoteId(t.name)}`).all();
			for (const row of rows) {
				if (t.name === "_emdash_api_tokens" && row.id === E2E_TOKEN_ID) {
					if (!options.adminToken) continue;
					row.token_hash = createHash("sha256").update(options.adminToken).digest("base64url");
					row.prefix = options.adminToken.slice(0, 11);
				}
				const columns = Object.keys(row).map((c) => (c === "__rowid" ? "rowid" : c));
				const values = Object.values(row).map(literal);
				out.push(
					`INSERT INTO ${quoteId(t.name)} (${columns.map(quoteId).join(", ")}) VALUES (${values.join(", ")});`,
				);
			}
		}
		for (const o of objects) if (o.type === "index" || o.type === "trigger") out.push(`${o.sql};`);
		return `${out.join("\n")}\n`;
	} finally {
		db.close();
	}
}

/** Seeds a throwaway SQLite database exactly like e2e/harness/serve.mjs and returns its path. */
export function seedDatabase(root, dir) {
	const file = join(dir, "data.db");
	const seed = spawnSync(
		process.execPath,
		[
			resolve(root, "node_modules/emdash/dist/cli/index.mjs"),
			"seed",
			"seed/seed.json",
			"--database",
			file,
			"--uploads-dir",
			join(dir, "uploads"),
		],
		{ cwd: root, stdio: ["ignore", "ignore", "inherit"] },
	);
	if (seed.status !== 0) throw new Error("[staging] emdash seed failed");
	applyBookingFixtures(root, file);
	applyEsignAdmin(root, file);
	return file;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const out = process.argv[2];
	if (!out) throw new Error("usage: node staging/seed-sql.mjs <out.sql>");
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const dir = mkdtempSync(join(tmpdir(), "semics-staging-seed-"));
	try {
		const sql = dumpSql(seedDatabase(root, dir), { adminToken: process.env.STAGING_ADMIN_TOKEN || undefined });
		writeFileSync(out, sql);
		console.log(`[staging] wrote ${sql.split("\n").length - 1} statements to ${out}`);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
