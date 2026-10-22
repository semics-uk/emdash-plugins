import { createPluginTestHost, type PluginTestHost } from "@emdash-cms/plugin-test";
import { afterEach, describe, expect, it } from "vitest";

let host: PluginTestHost | undefined;

afterEach(async () => {
	await host?.dispose();
	host = undefined;
});

describe("scaffold route (T057 review F14, T100)", () => {
	it("the template's hello route is gone before the route list freezes", async () => {
		host = await createPluginTestHost();
		await expect(host.invokeRoute("hello")).rejects.toThrow();
	});
});
