// Lighthouse accessibility gate for staging (T111, moved from T055): the nightly runs Lighthouse on
// the booking page and the page with the booking widget, then this checks every report scores at
// least 95. (Lighthouse is not installed locally: the local gate is axe, R56.)
//
//   node staging/lighthouse.mjs [--min 95] report.json...
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The accessibility score of one Lighthouse JSON report, 0-100. */
export function lighthouseScore(report) {
	const score = report?.categories?.accessibility?.score;
	if (typeof score !== "number") throw new Error("the report has no accessibility category score");
	return Math.round(score * 100);
}

/** Throws listing every report under `min`. */
export function assertLighthouse(reports, min = 95) {
	const low = reports
		.map((r) => ({ url: r.finalDisplayedUrl ?? r.finalUrl ?? r.requestedUrl ?? "?", score: lighthouseScore(r) }))
		.filter((r) => r.score < min);
	if (low.length) throw new Error(low.map((r) => `${r.url}: accessibility ${r.score} < ${min}`).join("\n"));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const at = args.indexOf("--min");
	const min = at >= 0 ? Number(args.splice(at, 2)[1]) : 95;
	const reports = args.map((file) => JSON.parse(readFileSync(file, "utf8")));
	if (!reports.length) throw new Error("usage: node staging/lighthouse.mjs [--min 95] report.json...");
	for (const r of reports) console.log(`[lighthouse] ${r.finalDisplayedUrl ?? r.requestedUrl}: ${lighthouseScore(r)}`);
	assertLighthouse(reports, min);
}
