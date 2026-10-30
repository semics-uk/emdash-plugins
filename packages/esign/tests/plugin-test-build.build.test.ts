import { cp, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emdashPluginTest } from "@emdash-cms/plugin-test/config";
import { afterAll, describe, expect, it } from "vitest";

// T138: the workers pool calls the plugin-test options callback once per pool worker, and each
// call rebuilt `dist/` in place. Two workers starting together could read a half-written
// manifest.json ("Unexpected end of JSON input" on CI). The patched plugin-test shares one build
// between concurrent starts. A copy of the small fixture keeps this test off any other project's dist.
const esignDir = fileURLToPath(new URL("..", import.meta.url));
const fixtureDir = fileURLToPath(new URL("./fixtures/shared-plugin", import.meta.url));
const vitestDist = dirname(fileURLToPath(import.meta.resolve("vitest")));

type PoolOptions = () => Promise<{ miniflare: { bindings: Record<string, string> } }>;

function poolOptionsFor(dir: string): PoolOptions {
	const [, workerPlugin] = emdashPluginTest({ dir }) as [unknown, { configureVitest(ctx: unknown): void }];
	const context = { project: { config: {} as { poolRunner?: { createPoolWorker(o: unknown): { poolOptions: PoolOptions } } } } };
	workerPlugin.configureVitest(context);
	const worker = context.project.config.poolRunner!.createPoolWorker({ project: { vitest: { distPath: vitestDist } } });
	return worker.poolOptions;
}

describe("T138 plugin-test builds once for concurrent pool workers", () => {
	let tmp: string | undefined;
	afterAll(async () => {
		if (tmp) await rm(tmp, { recursive: true, force: true });
	});

	it("concurrent starts share one build, and every manifest parses", async () => {
		// Inside the package, so the copy resolves @semics-tech/shared through its node_modules.
		tmp = await mkdtemp(join(esignDir, ".t138-"));
		await cp(fixtureDir, tmp, { recursive: true, filter: (src) => !src.includes("/dist") });
		const options = poolOptionsFor(tmp);
		const results = await Promise.all(Array.from({ length: 6 }, () => options()));
		expect(new Set(results).size).toBe(1);
		for (const r of results) expect(() => JSON.parse(r.miniflare.bindings.EMDASH_PLUGIN_MANIFEST)).not.toThrow();
	});
});
