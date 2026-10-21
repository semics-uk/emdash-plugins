import type { CoverageOptions } from "vitest/node";

export function coverageConfig(options?: { allSource?: boolean; strictBranches?: string[] }): CoverageOptions;
