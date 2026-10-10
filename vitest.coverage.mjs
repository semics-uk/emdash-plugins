/**
 * Shared Vitest coverage settings (v8).
 *
 * Thresholds follow tasks/README.md: 90% lines for pure domain code. They are per-glob, so they
 * apply as soon as files appear under `src/domain/**` and do nothing while the globs are empty.
 * `packages/shared` passes `{ allSource: true }` because every file in it is pure helper code.
 *
 * Usage in a package's vitest.config.ts:
 *   test: { coverage: coverageConfig() }
 */
export function coverageConfig({ allSource = false } = {}) {
	const domainGlobs = allSource ? ["src/**"] : ["src/domain/**"];
	return {
		provider: "v8",
		reporter: ["text-summary", "lcov"],
		include: ["src/**/*.{ts,tsx}"],
		exclude: ["**/*.test.*", "**/*.d.ts"],
		thresholds: Object.fromEntries(domainGlobs.map((glob) => [glob, { lines: 90 }])),
	};
}
