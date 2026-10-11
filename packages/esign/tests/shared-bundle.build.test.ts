import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { buildPlugin, bundlePlugin } from "@emdash-cms/plugin-cli";
import { describe, expect, it } from "vitest";

const fixtureDir = fileURLToPath(new URL("./fixtures/shared-plugin", import.meta.url));

/** Minimal ustar reader: returns the text of the named file. */
function tarFile(tar: Buffer, name: string): string | undefined {
	let offset = 0;
	while (offset + 512 <= tar.length) {
		const header = tar.subarray(offset, offset + 512);
		const entry = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
		if (!entry) return undefined;
		const size = Number.parseInt(header.toString("utf8", 124, 136).replace(/\0.*$/, "").trim() || "0", 8);
		if (entry.replace(/^\.\//, "") === name) return tar.toString("utf8", offset + 512, offset + 512 + size);
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return undefined;
}

describe("@semics-tech/shared bundling (node project)", () => {
	it("inlines shared code into dist/plugin.mjs with no node: imports", async () => {
		const out = await mkdtemp(join(tmpdir(), "shared-build-"));
		try {
			const build = await buildPlugin({ dir: fixtureDir, outDir: out });
			const code = await readFile(build.files.runtime, "utf8");
			expect(code).toContain("shared-0");
			expect(code).not.toContain("@semics-tech/shared");
			expect(code).not.toMatch(/(?:from|import\s*\(|require\s*\()\s*["']node:/);
		} finally {
			await rm(out, { recursive: true, force: true });
		}
	});

	it("inlines shared code into the registry bundle's backend.js", async () => {
		const out = await mkdtemp(join(tmpdir(), "shared-bundle-"));
		try {
			const result = await bundlePlugin({ dir: fixtureDir, outDir: out });
			expect(result.tarballPath).not.toBeNull();
			const tar = gunzipSync(await readFile(result.tarballPath as string));
			const backend = tarFile(tar, "backend.js");
			expect(backend).toBeDefined();
			expect(backend).toContain("shared-0");
			expect(backend).not.toContain("@semics-tech/shared");
			expect(backend).not.toMatch(/(?:from|import\s*\(|require\s*\()\s*["']node:/);
		} finally {
			await rm(out, { recursive: true, force: true });
		}
	});
});
