// T110 probe driver, written as tests against the deployed probe Worker.
//   PROBE_URL=https://semics-probe-limits.<sub>.workers.dev PROBE_KEY=… node --test probe.test.mjs
// Results go to results/<name>.json (numbers quoted in BUILD-PLAN §7).
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { test } from "node:test";

const BASE = process.env.PROBE_URL;
const KEY = process.env.PROBE_KEY;
const only = process.env.PROBE_ONLY?.split(",");
const run = (name) => !only || only.includes(name);
mkdirSync(new URL("./results/", import.meta.url), { recursive: true });
const save = (name, v) =>
	writeFileSync(new URL(`./results/${name}.json`, import.meta.url), `${JSON.stringify(v, null, 2)}\n`);

async function get(path) {
	assert.ok(BASE, "PROBE_URL is not set: deploy the probe Worker first (see README)");
	const res = await fetch(`${BASE}${path}`, { headers: { "x-probe-key": KEY ?? "" } });
	assert.equal(res.status, 200, `${path} -> HTTP ${res.status}`);
	return res.json();
}

test("setup", async () => {
	assert.deepEqual(await get("/setup"), { ok: true });
});

test("S1: probe route records the subrequest failure point (EV-NFR-01)", { skip: !run("s1") }, async () => {
	const out = [];
	const cases = [
		["rpc-noop", "emdash", false],
		["rpc-d1", "emdash", false],
		["rpc-kv", "emdash", false],
		["rpc-d1", "emdash", true],
		["fetch-outbound", "emdash", false],
		["rpc-d1", "none", false],
		["fetch-outbound", "none", false],
		["rpc-getmany", "emdash", false],
	];
	for (const [mode, limits, parallel] of cases) {
		const r = await get(`/s1?mode=${mode}&limits=${limits}&max=40&parallel=${parallel ? 1 : 0}`);
		out.push({ mode, limits, parallel, ...r });
	}
	// Repeat the headline case on the same isolate name to check it is stable across requests.
	for (let i = 0; i < 3; i++) {
		const r = await get("/s1?mode=rpc-d1&limits=emdash&max=40");
		out.push({ mode: "rpc-d1", limits: "emdash", repeat: i + 1, ...r });
	}
	save("s1", out);
	for (const r of out) {
		assert.ok(r.ok, `${r.mode}/${r.limits}: invocation failed: ${r.error}`);
		assert.equal(typeof r.result.completed, "number");
		assert.ok("firstFailureAt" in r.result || r.mode === "rpc-getmany");
	}
});

test("S4: storage document size limit on real D1", { skip: !run("s4") }, async () => {
	const sizes = [64 * 1024, 512 * 1024, 1024 * 1024, 1_900_000, 1_999_000, 2_000_000, 2 * 1024 * 1024, 4 * 1024 * 1024];
	const out = [];
	for (const bytes of sizes) out.push(await get(`/s4?bytes=${bytes}`));
	// Bisect the largest payload that stores.
	let lo = 64 * 1024;
	let hi = 4 * 1024 * 1024;
	for (const r of out) {
		if (r.ok && r.result.stored) lo = Math.max(lo, r.result.bytes);
		else hi = Math.min(hi, r.result?.bytes ?? hi);
	}
	while (hi - lo > 16) {
		const mid = Math.floor((lo + hi) / 2);
		const r = await get(`/s4?bytes=${mid}`);
		if (r.ok && r.result.stored) lo = mid;
		else hi = mid;
	}
	save("s4", { sizes: out, largestStoredPayload: lo, firstFailingPayload: hi, jsonOverhead: 11 });
	assert.ok(out.length === sizes.length);
});

test("unique index on real D1", { skip: !run("unique") }, async () => {
	const r = await get("/unique");
	save("unique", r);
	assert.equal(r.firstInsert, "ok");
});

async function passes(path, tries = 3) {
	let ok = 0;
	const errors = [];
	for (let i = 0; i < tries; i++) {
		const r = await get(path);
		if (r.ok) ok++;
		else errors.push(r.error);
	}
	return { ok, tries, errors: [...new Set(errors)] };
}

async function maxReps(engine, pages, extra = "") {
	// Largest number of renders in one invocation under cpuMs 50 (warm isolate).
	let lo = 0;
	let hi = 1;
	const path = (k) => `/pdf?engine=${engine}&pages=${pages}&reps=${k}&warm=1${extra}`;
	while (hi <= 512 && (await passes(path(hi), 2)).ok === 2) {
		lo = hi;
		hi *= 2;
	}
	while (hi - lo > 1) {
		const mid = Math.floor((lo + hi) / 2);
		if ((await passes(path(mid), 2)).ok === 2) lo = mid;
		else hi = mid;
	}
	return lo;
}

async function minCpuMs(engine, pages, extra = "") {
	// Smallest cpuMs limit at which one render passes 3/3 (warm isolate).
	let lo = 0;
	let hi = 64;
	while (hi - lo > 1) {
		const mid = Math.floor((lo + hi) / 2);
		const p = await passes(
			`/pdf?engine=${engine}&pages=${pages}&reps=1&warm=1&limits=custom&cpuMs=${mid}${extra}`,
		);
		if (p.ok === p.tries) hi = mid;
		else lo = mid;
	}
	return hi;
}

test("S5: PDF benchmark recorded for 1, 3 and 5 pages (EV-NFR-02)", { skip: !run("s5") }, async () => {
	const out = [];
	for (const engine of ["mini", "pdflib-create", "pdflib-stamp"]) {
		for (const pages of [1, 3, 5]) {
			const single = await get(`/pdf?engine=${engine}&pages=${pages}&reps=1&warm=1`);
			const cold = await get(
				`/pdf?engine=${engine}&pages=${pages}&reps=1&variant=cold-${Date.now()}`,
			);
			const reps = await maxReps(engine, pages);
			const cpu = await minCpuMs(engine, pages);
			out.push({
				engine,
				pages,
				singleUnder50ms: single.ok,
				coldUnder50ms: cold.ok,
				coldError: cold.error ?? null,
				size: single.result?.size,
				maxRendersPerInvocationAt50ms: reps,
				approxMsPerRender: reps > 0 ? +(50 / reps).toFixed(2) : null,
				minCpuMsLimitForOneRender: cpu,
			});
			console.log(JSON.stringify(out.at(-1)));
		}
	}
	// Heavier signature (pdf-mini, compressed) for the 5-page waiver case.
	for (const extra of ["&compress=1", "&strokes=20&points=400"]) {
		const reps = await maxReps("mini", 5, extra);
		out.push({ engine: "mini", pages: 5, extra, maxRendersPerInvocationAt50ms: reps });
	}
	save("s5", out);
	for (const pages of [1, 3, 5]) {
		assert.ok(out.find((r) => r.engine === "mini" && r.pages === pages && r.size > 0));
	}
});

test("cron: tick log", { skip: !run("cron") }, async () => {
	const ticks = await get("/ticks");
	const rows = ticks.map((t, i) => ({
		scheduledTime: new Date(t.scheduled_time).toISOString(),
		lateMs: t.started_at - t.scheduled_time,
		gapMs: i ? t.scheduled_time - ticks[i - 1].scheduled_time : null,
		s1: JSON.parse(t.s1),
	}));
	save("cron", rows);
	assert.ok(rows.length >= 2, "need at least two ticks");
});
