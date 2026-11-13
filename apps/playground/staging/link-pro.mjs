// The Pro variant of the playground (T111): links a built Events Pro from a local checkout of the
// private Pro repo into this site's node_modules, where astro.config.mjs picks it up. Nothing from Pro
// is committed here (R40): the link lives in node_modules, which git ignores.
//
//   EMDASH_PRO_DIR=../emdash-plugins-pro node staging/link-pro.mjs
//
// e2e/harness/build.mjs and staging/build.mjs call it whenever EMDASH_PRO_DIR is set.
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Package name -> folder in the Pro repo, and whether it must be built. Vouchers Pro (T168) is linked only when built. */
const PACKAGES = {
	events: ["@semics-tech/emdash-events-pro", "packages/events-pro", true],
	vouchers: ["@semics-tech/emdash-vouchers-pro", "packages/vouchers-pro", false],
};

/**
 * @param {string} siteRoot the playground folder
 * @param {string} proDir the Pro repo checkout
 * @returns {{ events: string, vouchers?: string }} where each package was linked
 */
export function linkPro(siteRoot, proDir) {
	if (!existsSync(proDir)) throw new Error(`EMDASH_PRO_DIR ${proDir} does not exist`);
	const linked = {};
	for (const [key, [name, folder, required]] of Object.entries(PACKAGES)) {
		const source = resolve(proDir, folder);
		const target = join(siteRoot, "node_modules", ...name.split("/"));
		const missing = ["dist/index.mjs", "dist/plugin.mjs"].find((file) => !existsSync(join(source, file)));
		if (missing && required) {
			throw new Error(`${name} is not built (${join(source, missing)} is missing): run its build in the Pro repo first`);
		}
		if (missing) {
			// Not built: leave no stale link behind, so the site is wired without it.
			if (isLink(target)) rmSync(target, { force: true });
			continue;
		}
		mkdirSync(dirname(target), { recursive: true });
		const current = existsSync(target) || isLink(target) ? lstatSync(target) : null;
		if (current?.isSymbolicLink() && resolve(dirname(target), readlinkSync(target)) === source) {
			linked[key] = target;
			continue;
		}
		if (current) rmSync(target, { recursive: true, force: true });
		symlinkSync(source, target, "dir");
		linked[key] = target;
	}
	return linked;
}

function isLink(path) {
	try {
		return lstatSync(path).isSymbolicLink();
	} catch {
		return false;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const proDir = process.env.EMDASH_PRO_DIR;
	if (!proDir) throw new Error("set EMDASH_PRO_DIR to the Pro repo checkout");
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	console.log(`[pro] linked ${Object.values(linkPro(root, resolve(proDir))).join(", ")}`);
}
