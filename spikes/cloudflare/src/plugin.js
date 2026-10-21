// Sandboxed probe "plugin": runs inside a Worker Loader isolate, like an EmDash sandboxed core.
// Host operations go through env.BRIDGE (a loopback WorkerEntrypoint RPC binding, the same shape as
// @emdash-cms/cloudflare's PluginBridge). Direct network access is off unless the host passes an
// outbound entrypoint for the fetch control.
import { makeStrokes, renderPdf } from "./pdf-mini.js";

async function sha256Hex(bytes) {
	const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
	return Array.from(d, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function oneCall(env, mode, i) {
	switch (mode) {
		case "rpc-noop":
			return env.BRIDGE.noop(i);
		case "rpc-d1":
			return env.BRIDGE.storageGet("docs", `doc-${i}`);
		case "rpc-kv":
			return env.BRIDGE.kvGet(`key-${i}`);
		case "fetch-outbound":
			return (await fetch(`https://outbound.invalid/${i}`)).text();
		default:
			throw new Error(`unknown mode ${mode}`);
	}
}

async function s1(env, { mode, max = 40, parallel = false }) {
	if (mode === "rpc-getmany") {
		const ids = Array.from({ length: max }, (_, i) => `doc-${i}`);
		try {
			const r = await env.BRIDGE.storageGetMany("docs", ids);
			return { mode, completed: 1, ids: ids.length, returned: Object.keys(r).length, error: null };
		} catch (e) {
			return { mode, completed: 0, error: String(e) };
		}
	}
	if (parallel) {
		const results = await Promise.allSettled(Array.from({ length: max }, (_, i) => oneCall(env, mode, i)));
		const firstFail = results.findIndex((r) => r.status === "rejected");
		return {
			mode,
			parallel,
			completed: results.filter((r) => r.status === "fulfilled").length,
			firstFailureAt: firstFail === -1 ? null : firstFail + 1,
			error: firstFail === -1 ? null : String(results[firstFail].reason),
		};
	}
	let completed = 0;
	for (let i = 0; i < max; i++) {
		try {
			await oneCall(env, mode, i);
			completed++;
		} catch (e) {
			return { mode, completed, firstFailureAt: i + 1, error: String(e) };
		}
	}
	return { mode, completed, firstFailureAt: null, error: null };
}

async function s4(env, { bytes, id }) {
	// The stored document is { blob: "<bytes x's>" }; JSON adds 11 bytes.
	const doc = { blob: "x".repeat(bytes) };
	try {
		await env.BRIDGE.storagePut("docs", id, doc);
	} catch (e) {
		return { bytes, jsonBytes: bytes + 11, stored: false, error: String(e) };
	}
	try {
		const back = await env.BRIDGE.storageGet("docs", id);
		return { bytes, jsonBytes: bytes + 11, stored: true, readBack: back?.blob?.length ?? null };
	} catch (e) {
		return { bytes, jsonBytes: bytes + 11, stored: true, readBack: null, error: String(e) };
	}
}

async function pdf({ pages, strokeCount = 6, strokePoints = 120, compress = false, reps = 1 }) {
	const strokes = makeStrokes(strokeCount, strokePoints);
	let size = 0;
	let hash = null;
	for (let r = 0; r < reps; r++) {
		const bytes = await renderPdf({ pages, strokes, compress });
		size = bytes.length;
		hash = await sha256Hex(bytes);
	}
	return { engine: "mini", pages, reps, compress, size, hash };
}

// Workers clocks only advance on I/O, so bracket the work with no-op bridge calls: the elapsed time
// is the work's CPU plus one RPC round trip; the baseline (two back-to-back calls) is that RTT.
async function timed(env, work, samples = 3) {
	const out = { baselineMs: [], workMs: [] };
	for (let i = 0; i < samples; i++) {
		await env.BRIDGE.noop(0);
		let t0 = Date.now();
		await env.BRIDGE.noop(1);
		out.baselineMs.push(Date.now() - t0);
		t0 = Date.now();
		out.last = await work();
		await env.BRIDGE.noop(2);
		out.workMs.push(Date.now() - t0);
	}
	return out;
}

export default {
	async fetch(request, env) {
		const body = await request.json();
		let result;
		if (body.op === "s1") result = await s1(env, body);
		else if (body.op === "s4") result = await s4(env, body);
		else if (body.op === "pdf") result = await pdf(body);
		else if (body.op === "timed") result = await timed(env, () => pdf(body), body.samples);
		else if (body.op === "ping") result = { pong: true };
		else result = { error: `unknown op ${body.op}` };
		return Response.json(result);
	},
};
