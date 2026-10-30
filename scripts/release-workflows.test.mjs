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
	assert.match(text, /publish-script: \$\{\{ vars\.NPM_PUBLISH == 'true' && 'pnpm release' \|\| '' \}\}/);
	assert.match(text, /version-script: pnpm version-packages/);
	assert.match(text, /pnpm release:dry-run/);
	assert.match(text, /branches: \[main\]/);
	assert.match(text, /environment: npm-publish/);
});

// T123: changesets/action v1 bundles the Changesets 2 readers, which take CLI 3's .changeset/pre/ directory
// for a changeset (ENOENT .changeset/pre/changes.md). v2 reads the CLI 3 layout and skips pre/.
test("T123 release.yml pins changesets/action v2 by commit, with its v2 input and output names", () => {
	const text = read("release.yml");
	assert.match(text, /uses: changesets\/action@[0-9a-f]{40} # v2\.\d+\.\d+/);
	const step = text.slice(text.indexOf("uses: changesets/action@")).split(/\n\s*- |\n\S/)[0];
	for (const v1 of ["publish", "version", "title", "commit"]) {
		assert.doesNotMatch(step, new RegExp(`^\\s+${v1}: `, "m"), `v1 input ${v1}`);
	}
	assert.match(step, /pr-title: /);
	assert.match(step, /commit-message: /);
	assert.match(text, /steps\.changesets\.outputs\.published-packages/);
	assert.doesNotMatch(text, /publishedPackages/);
});

// T123: in rc pre mode with every changeset consumed, the action would publish straight away. npm publishing
// waits for the owner's NPM_PUBLISH variable, so until then a push stops at the version PR or the dry run.
test("T123 release.yml publishes to npm only once the owner sets NPM_PUBLISH=true", () => {
	const code = read("release.yml")
		.split("\n")
		.filter((line) => !line.trim().startsWith("#"))
		.join("\n");
	assert.equal([...code.matchAll(/pnpm release(?!:)/g)].length, 1, "pnpm release appears once, behind the gate");
	assert.match(read("../../CONTRIBUTING.md"), /`NPM_PUBLISH=true`/);
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

test("T139 emdash-release.yml plans when called from release.yml, and skips publish on an empty plan", () => {
	const text = read("emdash-release.yml");
	// In a called workflow github.event_name is the caller's event (push), never workflow_call.
	assert.ok(!/event_name == 'workflow_call'/.test(text), "a called workflow never sees event_name workflow_call");
	assert.match(text, /id: changesets\n\s+if: \$\{\{ github\.event_name != 'workflow_dispatch' \}\}/);
	assert.match(text, /if: \$\{\{ needs\.plan\.outputs\.selectors != '' && needs\.plan\.outputs\.selectors != '\[\]' \}\}/);
});

test("R84: release.yml publishes to npm by trusted publishing (OIDC), with no stored npm token", () => {
	const text = read("release.yml");
	assert.match(text, /id-token: write/);
	assert.match(text, /if: github\.repository == 'semics-uk\/emdash-plugins'/);
	assert.match(text, /environment: npm-publish/);
	assert.match(text, /registry-url: https:\/\/registry\.npmjs\.org/);
	// npm CLI >= 11.5.1 is what exchanges the OIDC token; the run refuses an older one before publishing.
	assert.match(text, /node scripts\/npm-trust\.mjs check-npm/);
	assert.ok(text.indexOf("npm-trust.mjs check-npm") < text.indexOf("uses: changesets/action@"));
	assert.doesNotMatch(text, /NPM_TOKEN/);
	assert.doesNotMatch(text, /NODE_AUTH_TOKEN/);
	const secrets = [...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
	assert.deepEqual([...new Set(secrets)], ["GITHUB_TOKEN"]);
});

test("R84: no workflow references a long-lived npm token", () => {
	for (const file of all()) {
		const text = read(file);
		assert.doesNotMatch(text, /NPM_TOKEN/, `${file}: NPM_TOKEN`);
		assert.doesNotMatch(text, /NODE_AUTH_TOKEN:\s*\$\{\{\s*secrets\./, `${file}: NODE_AUTH_TOKEN from a secret`);
	}
});

test("root scripts quote their pnpm --filter globs (an unquoted ./packages/** is expanded by the runner's shell)", () => {
	const { scripts } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	for (const [name, command] of Object.entries(scripts)) {
		assert.doesNotMatch(command, /--filter\s+[^"'\s]*\*/, `script "${name}" has an unquoted --filter glob`);
	}
});
