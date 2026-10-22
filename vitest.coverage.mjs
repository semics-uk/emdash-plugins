/**
 * Shared Vitest coverage settings (v8).
 *
 * Thresholds follow tasks/README.md: 90% lines for pure domain code. They are per-glob, so they
 * apply as soon as files appear under `src/domain/**` and do nothing while the globs are empty.
 * `packages/shared` passes `{ allSource: true }` because every file in it is pure helper code.
 * `strictBranches` lists security-module globs held at 100% branches (tokens, HMAC, licence, audit).
 *
 * What is counted (T034): v8 sees only code that runs in the Vitest process, i.e. modules a test file
 * imports. A core's routes, cron jobs and Block Kit pages run inside workerd from the bundle that
 * `emdashPluginTest()` builds, so the host-level tests exercise them without adding a line to the report
 * (E-sign reads ~54% overall while its domain and security globs pass). Instrumenting that bundle would
 * mean an istanbul build of `backend.js` and collecting `__coverage__` out of each sandbox isolate, which
 * the test host does not support; so thresholds stay on code that is imported directly (domain, shared,
 * the UI helpers), routes stay thin, and every route and cron path is held by host tests with budget
 * assertions instead. Read the overall figure with that in mind; it is not a threshold.
 *
 * Usage in a package's vitest.config.ts:
 *   test: { coverage: coverageConfig() }
 */
export function coverageConfig({ allSource = false, strictBranches = [] } = {}) {
	const domainGlobs = allSource ? ["src/**"] : ["src/domain/**"];
	return {
		provider: "v8",
		reporter: ["text-summary", "lcov"],
		include: ["src/**/*.{ts,tsx}"],
		exclude: ["**/*.test.*", "**/*.d.ts"],
		thresholds: {
			...Object.fromEntries(domainGlobs.map((glob) => [glob, { lines: 90 }])),
			...Object.fromEntries(strictBranches.map((glob) => [glob, { lines: 90, branches: 100 }])),
		},
	};
}
