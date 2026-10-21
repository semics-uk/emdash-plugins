/**
 * Machine limits shared by every package's vitest config.
 *
 * Each workerd-backed test file starts sandboxes that take hundreds of MB, so local runs use at most
 * two workers (override with VITEST_MAX_WORKERS) and hold the machine-wide test lock
 * (scripts/test-lock.mjs) so suites from several worktrees never run at once. Coverage runs on CI
 * only (see each package's `test:verify` script).
 *
 * Usage: test: { ...machineLimits, coverage: coverageConfig(), projects: [...] }
 */
import { fileURLToPath } from "node:url";

export const machineLimits = {
	maxWorkers: Number(process.env.VITEST_MAX_WORKERS ?? 2),
	globalSetup: [fileURLToPath(new URL("./scripts/test-lock.mjs", import.meta.url))],
};
