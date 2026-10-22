import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// A small shape check for the workflows. CI runs the real `actionlint` (ci.yml); this runs offline
// and also pins the release rules: provenance, gating, no literal secrets.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, ".github", "workflows");
const read = (name) => readFileSync(join(dir, name), "utf8");
const all = () => readdirSync(dir).filter((f) => f.endsWith(".yml"));

test("every workflow has a name, triggers, permissions and jobs, and no tabs", () => {
	for (const file of all()) {
		const text = read(file);
		assert.match(text, /^name: /m, `${file}: name`);
		assert.match(text, /^on:/m, `${file}: on`);
		assert.match(text, /^permissions:/m, `${file}: top-level permissions`);
		assert.match(text, /^jobs:/m, `${file}: jobs`);
		assert.ok(!text.includes("\t"), `${file}: tab character`);
	}
});

test("every action is pinned to a ref and secrets are only referenced by name", () => {
	for (const file of all()) {
		const text = read(file);
		for (const [, ref] of text.matchAll(/^\s*(?:- )?uses:\s*(\S+)/gm)) {
			assert.ok(ref.startsWith("docker://") || ref.startsWith("./") || ref.includes("@"), `${file}: unpinned ${ref}`);
		}
		assert.ok(!/npm_[A-Za-z0-9]{30,}/.test(text), `${file}: looks like a literal npm token`);
		assert.ok(!/ghp_[A-Za-z0-9]{20,}/.test(text), `${file}: looks like a literal token`);
	}
});

test("release.yml: Changesets version PR, then npm publish with provenance", () => {
	const text = read("release.yml");
	assert.match(text, /changesets\/action@/);
	assert.match(text, /id-token: write/);
	assert.match(text, /NPM_CONFIG_PROVENANCE: "?true"?/);
	assert.match(text, /secrets\.NPM_TOKEN/);
	assert.match(text, /publish: pnpm release/);
	assert.match(text, /version: pnpm version-packages/);
	assert.match(text, /pnpm release:dry-run/);
	assert.match(text, /branches: \[main\]/);
	assert.match(text, /environment: npm-publish/);
});

test("release.yml hands published packages to the registry workflow only when explicitly enabled", () => {
	const text = read("release.yml");
	assert.match(text, /uses: \.\/\.github\/workflows\/emdash-release\.yml/);
	assert.match(text, /published-packages: \$\{\{ needs\.release\.outputs\.published-packages \}\}/);
	assert.match(text, /vars\.EMDASH_REGISTRY_PUBLISH == 'true'/);
	assert.match(text, /needs\.release\.outputs\.published == 'true'/);
});

test("emdash-release.yml is the reusable registry workflow (OIDC, no stored token)", () => {
	const text = read("emdash-release.yml");
	assert.match(text, /workflow_call:/);
	assert.match(text, /id-token: write/);
	assert.match(text, /attestations: write/);
	assert.match(text, /release plan/);
	assert.match(text, /release prepare/);
	assert.match(text, /release-action@/);
	assert.match(text, /--require-real-did/);
	assert.ok(!/secrets\./.test(text), "the registry publish uses GitHub OIDC, not a secret");
});
