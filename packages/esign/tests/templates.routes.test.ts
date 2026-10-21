import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

type Body = {
	ok: boolean;
	error?: { code: string };
	issues?: Array<{ path: string; code: string }>;
	template?: { id: string; name: string; version: number; status: string; body?: string; fields: string[] };
	templates?: Array<{ id: string; name: string; version: number; status: string; body?: string }>;
	versions?: number[];
};

async function setup() {
	runtime = await createPluginRuntimeTestHost();
	return withBudget(runtime);
}

describe("private template routes (ES-FR-01)", () => {
	it("creates version 1, updates to version 2 and keeps version 1 readable", async () => {
		const budget = await setup();
		const created = await budget.invokeRoute("templates/create", { name: "NDA", body: "Hello {{name}}" });
		expectWithinBudget(created);
		const c = created.value as Body;
		expect(c).toMatchObject({ ok: true, template: { name: "NDA", version: 1, status: "active", fields: ["name"] } });
		const id = c.template?.id as string;

		const updated = await budget.invokeRoute("templates/update", { id, name: "NDA", body: "Hi {{name}} {{date}}" });
		expectWithinBudget(updated);
		expect((updated.value as Body).template).toMatchObject({ version: 2, fields: ["name", "date"] });

		const v1 = await budget.invokeRoute("templates/get", { id, version: 1 });
		expectWithinBudget(v1);
		expect((v1.value as Body).template).toMatchObject({ version: 1, body: "Hello {{name}}" });
		const latest = await budget.invokeRoute("templates/get", { id });
		expectWithinBudget(latest);
		expect((latest.value as Body).template).toMatchObject({ version: 2, body: "Hi {{name}} {{date}}" });
		expect((latest.value as Body).versions).toEqual([1, 2]);
	});

	it("lists active templates without bodies, hides versions and filters archived", async () => {
		const budget = await setup();
		const a = (await budget.invokeRoute("templates/create", { name: "B template", body: "b" })).value as Body;
		await budget.invokeRoute("templates/create", { name: "A template", body: "a" });
		await budget.invokeRoute("templates/update", { id: a.template?.id, name: "B template", body: "b2" });
		const list = await budget.invokeRoute("templates/list", {});
		expectWithinBudget(list);
		const l = list.value as Body;
		expect(l.templates?.map((t) => t.name)).toEqual(["A template", "B template"]);
		expect(l.templates?.every((t) => t.body === undefined)).toBe(true);

		const archive = await budget.invokeRoute("templates/archive", { id: a.template?.id });
		expectWithinBudget(archive);
		expect((archive.value as Body).template).toMatchObject({ status: "archived", version: 2 });
		const active = (await budget.invokeRoute("templates/list", {})).value as Body;
		expect(active.templates?.map((t) => t.name)).toEqual(["A template"]);
		const archived = await budget.invokeRoute("templates/list", { status: "archived" });
		expectWithinBudget(archived);
		expect((archived.value as Body).templates?.map((t) => t.name)).toEqual(["B template"]);
	});

	it("an archived template cannot be updated", async () => {
		const budget = await setup();
		const c = (await budget.invokeRoute("templates/create", { name: "X", body: "x" })).value as Body;
		const id = c.template?.id;
		await budget.invokeRoute("templates/archive", { id });
		const r = await budget.invokeRoute("templates/update", { id, name: "X", body: "y" });
		expectWithinBudget(r);
		expect(r.value).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST" },
			issues: [{ code: "TEMPLATE_ARCHIVED" }],
		});
	});

	it("rejects invalid input and unknown ids", async () => {
		const budget = await setup();
		const bad = await budget.invokeRoute("templates/create", { name: "", body: "x" });
		expectWithinBudget(bad);
		expect(bad.value).toMatchObject({
			ok: false,
			error: { code: "BAD_REQUEST" },
			issues: [{ path: "name", code: "INVALID_NAME" }],
		});
		for (const [route, input] of [
			["templates/get", {}],
			["templates/get", { id: "t", version: 0 }],
			["templates/update", { name: "a", body: "b" }],
			["templates/archive", {}],
			["templates/list", { status: "weird" }],
		] as const) {
			const r = await budget.invokeRoute(route, input);
			expectWithinBudget(r);
			expect(r.value).toMatchObject({ ok: false, error: { code: "BAD_REQUEST" } });
		}
		for (const [route, input] of [
			["templates/get", { id: "missing" }],
			["templates/get", { id: "missing", version: 3 }],
			["templates/update", { id: "missing", name: "a", body: "b" }],
			["templates/archive", { id: "missing" }],
		] as const) {
			const r = await budget.invokeRoute(route, input);
			expectWithinBudget(r);
			expect(r.value).toMatchObject({ ok: false, error: { code: "TEMPLATE_NOT_FOUND" } });
		}
	});

	it("rejects unauthenticated calls to every private template route (runtime host)", async () => {
		await setup();
		for (const name of ["create", "update", "get", "list", "archive"]) {
			const res = await runtime?.actions.routes.request(`templates/${name}`, { method: "POST", body: {} });
			expect([401, 403]).toContain(res?.status);
		}
	});
});
