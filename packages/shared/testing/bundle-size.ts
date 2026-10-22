/**
 * Bundle-size budget for a plugin core's sandbox backend (R42, T118). Test-only, node project.
 *
 * The limit is the registry's per-file cap: `MAX_FILE_SIZE = 128 * 1024` in `@emdash-cms/plugin-cli`
 * (`src/bundle/utils.ts`, checked by `emdash-plugin validate` and `bundle`) and
 * `MAX_BUNDLE_FILE_BYTES = 128 * 1024` in the `emdash` runtime's registry install check
 * (`src/registry/artifact-verification.ts` via `validatePluginBundle`). Config-declared sandboxed
 * installs (`sandboxed: [...]` from npm) are not size-checked, but every build here must still
 * pass `validate` and stay publishable to the registry, so the cap applies to all four bundles.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { bundlePlugin } from "@emdash-cms/plugin-cli";

/** The registry's per-file cap on `backend.js`. */
export const REGISTRY_FILE_LIMIT = 128 * 1024;
/** Room kept free under the cap for Pro features (R42). */
export const BUNDLE_HEADROOM = 24 * 1024;
/** Largest `backend.js` a build may produce. */
export const BUNDLE_BUDGET = REGISTRY_FILE_LIMIT - BUNDLE_HEADROOM;

/** Byte size of each regular file in a ustar archive, by name. */
function tarSizes(tar: Buffer): Map<string, number> {
	const sizes = new Map<string, number>();
	let offset = 0;
	while (offset + 512 <= tar.length) {
		const header = tar.subarray(offset, offset + 512);
		const name = header.toString("utf8", 0, 100).replace(/\0.*$/s, "");
		if (!name) break;
		const size = Number.parseInt(header.toString("utf8", 124, 136).replace(/\0.*$/s, "").trim() || "0", 8);
		sizes.set(name.replace(/^\.\//, ""), size);
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	return sizes;
}

/** `emdash-plugin bundle` for `dir` into a temporary directory; the size of `backend.js` in bytes. */
export async function backendBytes(dir: string): Promise<number> {
	const outDir = await mkdtemp(join(tmpdir(), "semics-bundle-size-"));
	try {
		const result = await bundlePlugin({ dir, outDir });
		if (!result.tarballPath) throw new Error(`bundle of ${dir} produced no tarball`);
		const size = tarSizes(gunzipSync(await readFile(result.tarballPath))).get("backend.js");
		if (size === undefined) throw new Error(`bundle of ${dir} has no backend.js`);
		return size;
	} finally {
		await rm(outDir, { recursive: true, force: true });
	}
}

/** Human-readable KiB, one decimal. */
export const kib = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KiB`;
