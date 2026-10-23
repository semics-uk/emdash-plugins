import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
	BOOTSTRAP_VERSION,
	bootstrapCommands,
	MIN_NPM_PUBLISH,
	MIN_NPM_TRUST,
	npmAtLeast,
	placeholderManifest,
	TRUST,
} from "./npm-trust.mjs";
import { publishablePackages } from "./release-dry-run.mjs";

// R84: npm trusted publishing. The trusted publisher configured on npmjs.com must name exactly the
// repository, workflow file and environment the release runs from, or npm refuses the OIDC token.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const workflow = (file) => readFileSync(join(root, ".github", "workflows", file), "utf8");

test("npmAtLeast compares npm versions numerically", () => {
	assert.equal(npmAtLeast("11.5.1", MIN_NPM_PUBLISH), true);
	assert.equal(npmAtLeast("11.5.0", MIN_NPM_PUBLISH), false);
	assert.equal(npmAtLeast("11.19.0", MIN_NPM_PUBLISH), true);
	assert.equal(npmAtLeast("12.0.0", MIN_NPM_PUBLISH), true);
	assert.equal(npmAtLeast("10.9.2", MIN_NPM_PUBLISH), false);
	assert.equal(npmAtLeast("11.14.9", MIN_NPM_TRUST), false);
	assert.equal(npmAtLeast("11.15.0\n", MIN_NPM_TRUST), true);
	assert.equal(npmAtLeast("not a version", MIN_NPM_PUBLISH), false);
});

test("the trusted publisher names the real release workflow, environment and repository", () => {
	assert.deepEqual(TRUST, { repository: "semics-uk/emdash-plugins", file: "release.yml", environment: "npm-publish" });
	const text = workflow(TRUST.file);
	assert.match(text, new RegExp(`environment: ${TRUST.environment}\\b`));
	assert.match(text, new RegExp(`github\\.repository == '${TRUST.repository}'`));
});

test("every published package's repository.url is the trusted repository (npm checks it)", () => {
	for (const { name, pkg } of publishablePackages()) {
		assert.equal(pkg.repository?.url, `https://github.com/${TRUST.repository}`, name);
	}
});

test("the bootstrap placeholder is an empty, public, clearly labelled package", () => {
	const pkg = publishablePackages().find((p) => p.name === "@semics-tech/emdash-events").pkg;
	const placeholder = placeholderManifest(pkg);
	assert.equal(placeholder.name, "@semics-tech/emdash-events");
	assert.equal(placeholder.version, BOOTSTRAP_VERSION);
	assert.match(BOOTSTRAP_VERSION, /^0\.0\.0-/);
	assert.deepEqual(placeholder.repository, pkg.repository);
	assert.equal(placeholder.license, pkg.license);
	assert.equal(placeholder.private, undefined);
	for (const field of ["main", "exports", "dependencies", "peerDependencies", "scripts", "bin", "files"]) {
		assert.equal(placeholder[field], undefined, field);
	}
	assert.match(placeholder.description, /placeholder/i);
});

test("bootstrap publishes the placeholder under its own dist-tag, deprecates it, then adds the trusted publisher", () => {
	const commands = bootstrapCommands("@semics-tech/emdash-esign", { dir: "/tmp/x", access: "public" });
	assert.equal(commands.length, 3);
	const [publish, deprecate, trust] = commands;
	assert.deepEqual(publish, ["npm", "publish", "/tmp/x", "--access", "public", "--tag", "bootstrap"]);
	assert.deepEqual(deprecate.slice(0, 3), ["npm", "deprecate", `@semics-tech/emdash-esign@${BOOTSTRAP_VERSION}`]);
	assert.deepEqual(trust, [
		"npm",
		"trust",
		"github",
		"@semics-tech/emdash-esign",
		"--file",
		"release.yml",
		"--repository",
		"semics-uk/emdash-plugins",
		"--environment",
		"npm-publish",
		"--allow-publish",
		"--yes",
	]);
	assert.ok(!commands.flat().includes("--provenance"), "a laptop publish cannot carry provenance");
});

test("an already-published package only gets the trusted publisher", () => {
	const commands = bootstrapCommands("@semics-tech/emdash-esign", { dir: "/tmp/x", access: "public", exists: true });
	assert.equal(commands.length, 1);
	assert.deepEqual(commands[0].slice(0, 4), ["npm", "trust", "github", "@semics-tech/emdash-esign"]);
});
