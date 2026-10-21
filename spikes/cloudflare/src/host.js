// T110 probe host. Mirrors @emdash-cms/cloudflare 1.2.0's sandbox runner: each request builds a
// fresh loopback bridge binding from ctx.exports and calls LOADER.get(name, …) with
// { cpuMs: 50, subRequests: 10 } and globalOutbound: null (src/sandbox/runner.ts createWorker).
import { WorkerEntrypoint, exports } from "cloudflare:workers";
import { pdfLib, pdfMini, plugin, pluginPdflib } from "../gen/modules.js";
import { renderPdf } from "./pdf-mini.js";

const EMDASH_LIMITS = { cpuMs: 50, subRequests: 10 };

// Same SQL as PluginBridge.storageGet / storagePut over the _plugin_storage table.
export class ProbeBridge extends WorkerEntrypoint {
	noop(i) {
		return i;
	}
	async storageGet(collection, id) {
		const row = await this.env.DB.prepare(
			"SELECT data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id = ?",
		)
			.bind(this.ctx.props.pluginId, collection, id)
			.first();
		return row ? JSON.parse(row.data) : null;
	}
	async storageGetMany(collection, ids) {
		const placeholders = ids.map(() => "?").join(",");
		const { results } = await this.env.DB.prepare(
			`SELECT id, data FROM _plugin_storage WHERE plugin_id = ? AND collection = ? AND id IN (${placeholders})`,
		)
			.bind(this.ctx.props.pluginId, collection, ...ids)
			.all();
		return Object.fromEntries(results.map((r) => [r.id, JSON.parse(r.data)]));
	}
	async storagePut(collection, id, data) {
		const json = JSON.stringify(data);
		await this.env.DB.prepare(
			`INSERT INTO _plugin_storage (plugin_id, collection, id, data, created_at, updated_at)
			 VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
			 ON CONFLICT (plugin_id, collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
		)
			.bind(this.ctx.props.pluginId, collection, id, json)
			.run();
	}
	async kvGet(key) {
		const row = await this.env.DB.prepare("SELECT value FROM _probe_kv WHERE key = ?")
			.bind(key)
			.first();
		return row?.value ?? null;
	}
}

// Stands in for the outside network so the fetch control never leaves Cloudflare.
export class ProbeOutbound extends WorkerEntrypoint {
	fetch() {
		return new Response("ok");
	}
}

function loadPlugin(env, { name, limits, outbound = false, pdflib = false }) {
	const bridge = exports.ProbeBridge({ props: { pluginId: "semics-probe" } });
	return env.LOADER.get(name, () => ({
		compatibilityDate: "2026-04-01",
		mainModule: "plugin.js",
		modules: pdflib
			? { "plugin.js": { js: pluginPdflib }, "pdf-lib.js": { js: pdfLib } }
			: { "plugin.js": { js: plugin }, "pdf-mini.js": { js: pdfMini } },
		globalOutbound: outbound ? exports.ProbeOutbound({ props: {} }) : null,
		...(limits ? { limits } : {}),
		env: { PLUGIN_ID: "semics-probe", BRIDGE: bridge },
	}));
}

async function invoke(stub, body) {
	try {
		const res = await stub.getEntrypoint().fetch("https://plugin/", {
			method: "POST",
			body: JSON.stringify(body),
		});
		return { ok: true, status: res.status, result: await res.json() };
	} catch (e) {
		return { ok: false, error: String(e) };
	}
}

function parseLimits(q) {
	const l = q.get("limits") ?? "emdash";
	if (l === "none") return null;
	if (l === "emdash") return EMDASH_LIMITS;
	const out = {};
	if (q.get("cpuMs")) out.cpuMs = Number(q.get("cpuMs"));
	if (q.get("sub")) out.subRequests = Number(q.get("sub"));
	return out;
}

async function setup(env) {
	await env.DB.batch([
		env.DB.prepare(`CREATE TABLE IF NOT EXISTS _plugin_storage (
			plugin_id TEXT NOT NULL, collection TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL,
			created_at TEXT, updated_at TEXT, revision TEXT,
			PRIMARY KEY (plugin_id, collection, id))`),
		env.DB.prepare("CREATE TABLE IF NOT EXISTS _probe_kv (key TEXT PRIMARY KEY, value TEXT)"),
		env.DB.prepare(`CREATE TABLE IF NOT EXISTS _probe_ticks (
			id INTEGER PRIMARY KEY AUTOINCREMENT, cron TEXT, scheduled_time INTEGER, started_at INTEGER,
			s1 TEXT)`),
	]);
	const stmts = [];
	for (let i = 0; i < 60; i++) {
		stmts.push(
			env.DB.prepare(
				"INSERT OR REPLACE INTO _plugin_storage (plugin_id, collection, id, data) VALUES (?, ?, ?, ?)",
			).bind("semics-probe", "docs", `doc-${i}`, JSON.stringify({ n: i })),
			env.DB.prepare("INSERT OR REPLACE INTO _probe_kv (key, value) VALUES (?, ?)").bind(
				`key-${i}`,
				String(i),
			),
		);
	}
	await env.DB.batch(stmts);
	return { ok: true };
}

// Unique-index behaviour on real D1, with EmDash's exact DDL (storage-indexes.ts
// generateCreateIndexSql) and put SQL (plugin-storage.ts: ON CONFLICT on the primary key only).
async function uniqueProbe(env) {
	const db = env.DB;
	const out = {};
	await db.prepare("DELETE FROM _plugin_storage WHERE collection = 'uq'").run();
	await db
		.prepare(
			`CREATE UNIQUE INDEX IF NOT EXISTS "uidx_plugin_semics-probe_uq_email"
			 ON _plugin_storage(plugin_id, collection, json_extract(data, '$.email'))`,
		)
		.run();
	const put = (id, data) =>
		db
			.prepare(
				`INSERT INTO _plugin_storage (plugin_id, collection, id, data, created_at, updated_at)
				 VALUES ('semics-probe', 'uq', ?, ?, datetime('now'), datetime('now'))
				 ON CONFLICT (plugin_id, collection, id) DO UPDATE SET data = excluded.data`,
			)
			.bind(id, JSON.stringify(data))
			.run()
			.then(
				() => "ok",
				(e) => String(e),
			);
	out.firstInsert = await put("a", { email: "x@example.com" });
	out.duplicateValueOtherId = await put("b", { email: "x@example.com" });
	out.sameIdUpdate = await put("a", { email: "x@example.com", v: 2 });
	out.missingField1 = await put("c", { other: 1 });
	out.missingField2 = await put("d", { other: 2 });
	out.nullField1 = await put("e", { email: null });
	out.nullField2 = await put("f", { email: null });
	out.caseDiffers = await put("g", { email: "X@example.com" });
	out.otherCollectionSameValue = await db
		.prepare(
			"INSERT INTO _plugin_storage (plugin_id, collection, id, data) VALUES ('semics-probe', 'uq2', 'a', ?)",
		)
		.bind(JSON.stringify({ email: "x@example.com" }))
		.run()
		.then(
			() => "ok",
			(e) => String(e),
		);
	// Batch atomicity: a batch whose second statement violates the index.
	out.batchWithViolation = await db
		.batch([
			db
				.prepare(
					"INSERT INTO _plugin_storage (plugin_id, collection, id, data) VALUES ('semics-probe', 'uq', 'h', ?)",
				)
				.bind(JSON.stringify({ email: "h@example.com" })),
			db
				.prepare(
					"INSERT INTO _plugin_storage (plugin_id, collection, id, data) VALUES ('semics-probe', 'uq', 'i', ?)",
				)
				.bind(JSON.stringify({ email: "x@example.com" })),
		])
		.then(
			() => "ok",
			(e) => String(e),
		);
	out.batchFirstRowPresent =
		(await db
			.prepare("SELECT COUNT(*) AS n FROM _plugin_storage WHERE collection = 'uq' AND id = 'h'")
			.first("n")) > 0;
	const { results } = await db
		.prepare("SELECT id, data FROM _plugin_storage WHERE collection = 'uq' ORDER BY id")
		.all();
	out.rows = results;
	await db.prepare('DROP INDEX IF EXISTS "uidx_plugin_semics-probe_uq_email"').run();
	await db.prepare("DELETE FROM _plugin_storage WHERE collection IN ('uq','uq2')").run();
	return out;
}

function toB64(bytes) {
	let s = "";
	for (let i = 0; i < bytes.length; i += 0x8000) {
		s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
	}
	return btoa(s);
}

export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		const q = url.searchParams;
		if (!env.PROBE_KEY || request.headers.get("x-probe-key") !== env.PROBE_KEY) {
			return new Response("forbidden", { status: 403 });
		}
		const json = (v) => Response.json(v);
		const variant = q.get("variant") ?? "0";

		if (url.pathname === "/setup") return json(await setup(env));
		if (url.pathname === "/unique") return json(await uniqueProbe(env));
		if (url.pathname === "/ticks") {
			const { results } = await env.DB.prepare("SELECT * FROM _probe_ticks ORDER BY id").all();
			return json(results);
		}
		if (url.pathname === "/s1") {
			const limits = parseLimits(q);
			const mode = q.get("mode") ?? "rpc-d1";
			const stub = loadPlugin(env, {
				name: `s1-${JSON.stringify(limits)}-${mode}-${variant}`,
				limits,
				outbound: mode === "fetch-outbound",
			});
			return json({
				limits,
				...(await invoke(stub, {
					op: "s1",
					mode,
					max: Number(q.get("max") ?? 40),
					parallel: q.get("parallel") === "1",
				})),
			});
		}
		if (url.pathname === "/s4") {
			const bytes = Number(q.get("bytes"));
			const stub = loadPlugin(env, { name: `s4-${variant}`, limits: EMDASH_LIMITS });
			const r = await invoke(stub, { op: "s4", bytes, id: `big-${bytes}` });
			await env.DB.prepare("DELETE FROM _plugin_storage WHERE id = ?").bind(`big-${bytes}`).run();
			return json(r);
		}
		if (url.pathname === "/pdf") {
			const engine = q.get("engine") ?? "mini";
			const limits = parseLimits(q);
			const pages = Number(q.get("pages") ?? 1);
			const pdflib = engine !== "mini";
			const stub = loadPlugin(env, {
				name: `pdf-${engine}-${JSON.stringify(limits)}-${variant}`,
				limits,
				pdflib,
			});
			const body = {
				op: engine === "mini" ? "pdf" : engine,
				pages,
				reps: Number(q.get("reps") ?? 1),
				compress: q.get("compress") === "1",
				strokeCount: Number(q.get("strokes") ?? 6),
				strokePoints: Number(q.get("points") ?? 120),
			};
			if (engine === "pdflib-stamp") {
				body.base = toB64(await renderPdf({ pages, strokes: null }));
			}
			if (q.get("warm") === "1") await invoke(stub, { op: "ping" });
			if (q.get("timed") === "1") {
				body.samples = Number(q.get("samples") ?? 3);
				if (engine === "mini") body.op = "timed";
				else body.timed = true;
			}
			return json({ limits, ...(await invoke(stub, body)) });
		}
		return new Response("not found", { status: 404 });
	},

	async scheduled(controller, env, ctx) {
		const startedAt = Date.now();
		const stub = loadPlugin(env, { name: "cron-s1", limits: EMDASH_LIMITS });
		const s1 = await invoke(stub, { op: "s1", mode: "rpc-d1", max: 15 });
		await env.DB.prepare(
			"INSERT INTO _probe_ticks (cron, scheduled_time, started_at, s1) VALUES (?, ?, ?, ?)",
		)
			.bind(controller.cron, controller.scheduledTime, startedAt, JSON.stringify(s1))
			.run();
	},
};

