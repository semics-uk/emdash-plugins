import { createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";
import { afterEach, describe, expect, it } from "vitest";
import { renderPdf } from "../src/pdf";
import { expectWithinBudget, PLATFORM_BUDGET, withBudget } from "../testing/budget";
import { waiverDocument } from "./fixtures/pdf-waiver";

// Runs the T016 writer inside the Worker Loader sandbox through the budget fixture's `pdf` route.

let host: PluginTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

describe("T016 PDF writer in the sandbox (ES-NFR-01, Spike S5 local proxy)", () => {
	it("ES-NFR-01: a 5-page waiver with 2 signatures renders under the CPU ceiling with no bridge calls", async () => {
		host = await createPluginTestHost();
		const budget = withBudget(host);
		await budget.invokeRoute("pdf"); // warm isolate, as on a serving Worker
		for (let run = 0; run < 3; run++) {
			const result = await budget.invokeRoute("pdf");
			expect(result.calls).toEqual([]);
			expectWithinBudget(result, PLATFORM_BUDGET);
			const value = result.value as { bytes: number; sha256: string };
			expect(value.bytes).toBe(renderPdf(waiverDocument()).length);
			expect(value.sha256).toMatch(/^[0-9a-f]{64}$/);
		}
	});
});
