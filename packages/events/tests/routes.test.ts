import { createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";
import { afterEach, describe, expect, it } from "vitest";

import { PUBLIC_ROUTES } from "../src/routes/public";

let host: PluginTestHost | undefined;
afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

describe("trust contract as loaded by the host", () => {
	it("allows exactly one outbound host: challenges.cloudflare.com", async () => {
		host = await createPluginTestHost();
		expect(host.manifest.allowedHosts).toEqual(["challenges.cloudflare.com"]);
	});
});

describe("public routes (route list matches BUILD-PLAN 3.1)", () => {
	const EXPECTED = [
		"public/events",
		"public/event",
		"public/checkout/reserve",
		"public/checkout/continue",
		"public/booking",
		"public/booking/cancel",
		"public/booking/ics",
		"public/event/ics",
		"public/waitlist/join",
		"public/waitlist/claim",
		"webhooks/stripe",
		"signatures/receipt",
	];

	it("lists every route in the PRD table", () => {
		expect(Object.keys(PUBLIC_ROUTES).sort()).toEqual([...EXPECTED].sort());
	});

	// Routes whose task has landed have their own tests.
	const IMPLEMENTED = new Set(["public/checkout/reserve", "public/checkout/continue"]);
	for (const name of EXPECTED.filter((n) => !IMPLEMENTED.has(n))) {
		it(`${name} is a stub that answers through the shared error registry`, async () => {
			host = await createPluginTestHost();
			const body = await host.invokeRoute(name);
			expect(body).toEqual({
				ok: false,
				error: { code: "NOT_FOUND", message: "Not found." },
			});
		});
	}
});
