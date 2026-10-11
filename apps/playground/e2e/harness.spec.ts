import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Harness guarantee: every run starts from identical, freshly seeded state (database and uploads
// reset). The first test fingerprints the seeded state and compares it with the fingerprint the
// previous run saved; the last test dirties the state (a stale upload) so the next run can only
// pass if the reset really wiped it.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const fingerprintFile = resolve(root, ".e2e-state/last-fingerprint.json");
const staleUpload = resolve(root, "uploads/stale-from-previous-run.txt");

const EXPECTED_SLUGS = ["past-gala", "london-meetup", "nyc-workshop", "sydney-conference"];

test.describe.configure({ mode: "serial" });

test("the seeded events collection is present and uploads were reset", async ({ page }) => {
	await page.goto("/events");
	const rows = page.getByTestId("event-row");
	await expect(rows).toHaveCount(EXPECTED_SLUGS.length);

	const fingerprint = await rows.evaluateAll((els) =>
		els.map((el) => ({
			slug: el.getAttribute("data-slug"),
			title: el.getAttribute("data-title"),
			startsAt: el.getAttribute("data-starts-at"),
			timezone: el.getAttribute("data-timezone"),
		})),
	);
	expect(fingerprint.map((f) => f.slug)).toEqual(EXPECTED_SLUGS);
	expect(new Set(fingerprint.map((f) => f.timezone))).toEqual(
		new Set(["Europe/London", "America/New_York", "Australia/Sydney"]),
	);

	// The stale upload planted by the previous run must be gone.
	expect(existsSync(staleUpload)).toBe(false);

	// Identical to the previous run, when there was one.
	if (existsSync(fingerprintFile)) {
		expect(fingerprint).toEqual(JSON.parse(readFileSync(fingerprintFile, "utf8")));
	}
	mkdirSync(dirname(fingerprintFile), { recursive: true });
	writeFileSync(fingerprintFile, JSON.stringify(fingerprint, null, 2));
});

test("dirty the state so the next run proves the reset", async () => {
	mkdirSync(dirname(staleUpload), { recursive: true });
	writeFileSync(staleUpload, "left over from the previous run");
	expect(existsSync(staleUpload)).toBe(true);
});
