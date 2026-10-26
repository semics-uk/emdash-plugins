import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
	auditBundle,
	auditTarball,
	PUBLISHER_DID,
	publishablePackages,
	readTarball,
	releaseBlockers,
} from "./release-dry-run.mjs";

const NAME = "@semics-tech/emdash-events";
const repoRoot = join(dirname(new URL(import.meta.url).pathname), "..");

/** A well-formed package tarball: path (without the `package/` prefix) -> text. */
function goodEntries(overrides = {}) {
	const entries = new Map(
		Object.entries({
			"package.json": JSON.stringify({
				name: NAME,
				version: "0.1.0",
				license: "MIT",
				dependencies: {},
				peerDependencies: { emdash: ">=1.2.0 <2" },
				devDependencies: { "@semics-tech/shared": "workspace:*" },
			}),
			LICENSE: "MIT",
			"README.md": "# events",
			"emdash-plugin.jsonc": "{}",
			"dist/index.mjs": "export {}",
			"dist/plugin.mjs": "export {}",
			"dist/manifest.json": "{}",
			"dist/ts/ui/index.js": 'import { x } from "emdash/ui";',
			"src/astro/BookingPage.astro": "---\n---\n<div/>",
			"src/client/booking.ts": "export {}",
		}),
	);
	for (const [path, text] of Object.entries(overrides)) {
		if (text === null) entries.delete(path);
		else entries.set(path, text);
	}
	return entries;
}

const audit = (entries) => auditTarball({ name: NAME, entries });

test("a well-formed package tarball has no problems", () => {
	assert.deepEqual(audit(goodEntries()), []);
});

test("reports each missing expected file", () => {
	const problems = audit(goodEntries({ "dist/plugin.mjs": null, LICENSE: null }));
	assert.ok(problems.some((p) => p.includes("dist/plugin.mjs")));
	assert.ok(problems.some((p) => p.includes("LICENSE")));
});

test("rejects tests, env files, coverage, logs, keys and tooling config", () => {
	for (const path of [
		"tests/booking.test.ts",
		"src/domain/price.test.ts",
		"src/domain/price.spec.ts",
		".env",
		".env.production",
		"coverage/lcov.info",
		".verify.log",
		"node_modules/x/index.js",
		"vitest.config.ts",
		"keys/signing.pem",
	]) {
		const problems = audit(goodEntries({ [path]: "x" }));
		assert.ok(
			problems.some((p) => p.includes(path)),
			`${path} should be flagged, got ${JSON.stringify(problems)}`,
		);
	}
});

test("rejects Pro code and licence material", () => {
	for (const [path, text] of [
		["pro.json", "{}"],
		["src/generated/build.ts", "export const DEV_KEY = true"],
		["licence/public-key.txt", "abc"],
		["dist/extra.mjs", 'import "@semics-tech/pro-kit"'],
		["dist/more.mjs", 'name = "@semics-tech/emdash-events-pro"'],
	]) {
		assert.ok(audit(goodEntries({ [path]: text })).length > 0, `${path} should be flagged`);
	}
});

test("R35: native UI code must not import @semics-tech/shared", () => {
	for (const path of ["src/astro/BookingPage.astro", "src/client/booking.ts", "dist/ts/ui/index.js"]) {
		const problems = audit(goodEntries({ [path]: 'import { money } from "@semics-tech/shared";' }));
		assert.ok(
			problems.some((p) => p.includes(path) && p.includes("@semics-tech/shared")),
			`${path} should be flagged`,
		);
	}
});

test("R35: a deep import of shared is flagged too", () => {
	const problems = audit(goodEntries({ "dist/ts/ui/index.js": "import x from '@semics-tech/shared/testing'" }));
	assert.ok(problems.length > 0);
});

test("shared as a devDependency is fine, as a runtime dependency is not", () => {
	const pkg = JSON.parse(goodEntries().get("package.json"));
	pkg.dependencies = { "@semics-tech/shared": "0.0.0" };
	assert.ok(audit(goodEntries({ "package.json": JSON.stringify(pkg) })).some((p) => p.includes("@semics-tech/shared")));
});

test("an unresolved workspace: protocol in dependencies is flagged", () => {
	const pkg = JSON.parse(goodEntries().get("package.json"));
	pkg.peerDependencies = { emdash: "workspace:*" };
	assert.ok(audit(goodEntries({ "package.json": JSON.stringify(pkg) })).some((p) => p.includes("workspace:")));
});

test("secrets in shipped files are flagged", () => {
	assert.ok(audit(goodEntries({ "dist/x.mjs": "-----BEGIN PRIVATE KEY-----" })).length > 0);
	assert.ok(audit(goodEntries({ "dist/x.mjs": `npm_${"a1B2".repeat(9)}` })).length > 0);
});

test("the package name must match", () => {
	const pkg = { name: "@semics-tech/other", version: "1.0.0" };
	assert.ok(audit(goodEntries({ "package.json": JSON.stringify(pkg) })).some((p) => p.includes("name")));
});

test("bundle: needs manifest.json and backend.js, and nothing private", () => {
	const ok = new Map([
		["manifest.json", "{}"],
		["backend.js", "export default {}"],
		["README.md", "x"],
	]);
	assert.deepEqual(auditBundle({ entries: ok }), []);
	const missing = new Map([["manifest.json", "{}"]]);
	assert.ok(auditBundle({ entries: missing }).some((p) => p.includes("backend.js")));
	const leaky = new Map(ok).set("backend.js", 'import "@semics-tech/shared"').set("tests/a.test.js", "x");
	const problems = auditBundle({ entries: leaky });
	assert.ok(problems.some((p) => p.includes("@semics-tech/shared")));
	assert.ok(problems.some((p) => p.includes("tests/a.test.js")));
});

test("R86: release blockers: any publisher but the semics DID, and a still-private package, stop a real release", () => {
	assert.equal(PUBLISHER_DID, "did:plc:mire6xkehfirmoj5pmpqgpvq");
	const ready = { manifest: { publisher: PUBLISHER_DID }, pkg: { private: false } };
	assert.deepEqual(releaseBlockers(ready), []);
	const blockers = releaseBlockers({
		manifest: { publisher: "did:plc:abcdefghijklmnopqrstuvwx" },
		pkg: { private: true },
	});
	assert.equal(blockers.length, 2);
	assert.ok(blockers.some((b) => b.includes("R86") && b.includes("publisher DID")));
	assert.ok(blockers.some((b) => b.includes("private")));
});

test("R86: an npm-only package (no emdash-plugin manifest, nothing for the registry) needs no publisher DID", () => {
	assert.deepEqual(releaseBlockers({ manifest: null, pkg: { private: false } }), []);
	assert.equal(releaseBlockers({ manifest: null, pkg: { private: true } }).length, 1);
});

test("R86: every manifest and fixture names the semics publisher DID, semics.co.uk and its security address", () => {
	const listed = spawnSync("git", ["ls-files", "*emdash-plugin.jsonc"], { cwd: repoRoot, encoding: "utf8" });
	const manifests = listed.stdout.split("\n").filter(Boolean);
	assert.ok(manifests.length >= 5, manifests.join(", "));
	for (const file of manifests) {
		const text = readFileSync(join(repoRoot, file), "utf8");
		assert.match(text, new RegExp(`"publisher": "${PUBLISHER_DID}"`), file);
		assert.match(text, /"url": "https:\/\/semics\.co\.uk"/, file);
		assert.match(text, /"email": "security@semics\.co\.uk"/, file);
	}
});

test("R86: no tracked file mentions the old handle or the placeholder DID", () => {
	// Built from parts so this file does not match itself.
	const old = new RegExp(["semics", "\\.dev|semicsdev", "placeholder"].join(""));
	const listed = spawnSync("git", ["grep", "-l", "-E", old.source], { cwd: repoRoot, encoding: "utf8" });
	assert.deepEqual(listed.stdout.split("\n").filter(Boolean), []);
});

test("readTarball extracts a real .tgz into a path -> text map without the package/ prefix", () => {
	const dir = mkdtempSync(join(tmpdir(), "rdr-"));
	try {
		const root = join(dir, "package");
		for (const [path, text] of [
			["package.json", "{}"],
			["dist/a.mjs", "x"],
		]) {
			mkdirSync(dirname(join(root, path)), { recursive: true });
			writeFileSync(join(root, path), text);
		}
		const file = join(dir, "x.tgz");
		assert.equal(spawnSync("tar", ["-czf", file, "-C", dir, "package"]).status, 0);
		const entries = readTarball(file);
		assert.deepEqual([...entries.keys()].sort(), ["dist/a.mjs", "package.json"]);
		assert.equal(entries.get("dist/a.mjs"), "x");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("publishablePackages lists events and esign (and the suite when present), never shared", () => {
	const names = publishablePackages().map((p) => p.name);
	assert.ok(names.includes("@semics-tech/emdash-events"));
	assert.ok(names.includes("@semics-tech/emdash-esign"));
	assert.ok(!names.includes("@semics-tech/shared"));
});
