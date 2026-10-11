import { createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";
import { afterEach, describe, expect, it } from "vitest";

let host: PluginTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

// Runs against tests/fixtures/shared-plugin (vitest.config.ts, project "shared-host").
describe("@semics-tech/shared inside the sandbox host", () => {
	it("serves a route that calls the shared function", async () => {
		host = await createPluginTestHost();
		expect(await host.invokeRoute("version")).toEqual({ version: "shared-0" });
	});
});
