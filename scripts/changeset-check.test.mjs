import assert from "node:assert/strict";
import { test } from "node:test";
import { checkChangesets, parseChangesetPackages } from "./changeset-check.mjs";

const published = [
	{ name: "@semics-tech/emdash-events", dir: "packages/events" },
	{ name: "@semics-tech/emdash-esign", dir: "packages/esign" },
];
const events = "@semics-tech/emdash-events";
const esign = "@semics-tech/emdash-esign";

function check(changedFiles, changesets = [], dependencyChanges = []) {
	return checkChangesets({ changedFiles, changesets, published, dependencyChanges });
}

test("a change under packages/events/src with no changeset fails", () => {
	const result = check(["packages/events/src/domain/capacity.ts"]);
	assert.equal(result.ok, false);
	assert.deepEqual(result.missing, [events]);
});

test("a change under packages/events/src passes when a changeset names the package", () => {
	assert.equal(check(["packages/events/src/plugin.ts"], [{ file: "a.md", packages: [events] }]).ok, true);
});

test("a changeset naming a different package does not satisfy the check", () => {
	const result = check(["packages/events/src/plugin.ts"], [{ file: "a.md", packages: [esign] }]);
	assert.equal(result.ok, false);
	assert.deepEqual(result.missing, [events]);
});

test("emdash-plugin.jsonc changes require a changeset", () => {
	assert.deepEqual(check(["packages/esign/emdash-plugin.jsonc"]).missing, [esign]);
});

test("dependency changes in a published package.json require a changeset", () => {
	assert.deepEqual(check(["packages/events/package.json"], [], ["packages/events"]).missing, [events]);
});

test("package.json changes that leave dependencies alone do not", () => {
	assert.equal(check(["packages/events/package.json"]).ok, true);
});

test("changes only under tasks/, docs/, markdown, tests and config pass", () => {
	const result = check([
		"tasks/T002-x.md",
		"docs/protocol/esign-intent.md",
		"README.md",
		"packages/events/README.md",
		"packages/events/tests/booking.test.ts",
		"packages/events/vitest.config.ts",
		"biome.json",
		".github/workflows/ci.yml",
		"apps/playground/src/pages/index.astro",
	]);
	assert.equal(result.ok, true);
	assert.deepEqual(result.required, []);
});

test("every affected package needs its own changeset", () => {
	const files = ["packages/events/src/a.ts", "packages/esign/src/b.ts"];
	assert.deepEqual(check(files, [{ file: "a.md", packages: [events] }]).missing, [esign]);
	assert.equal(check(files, [{ file: "a.md", packages: [events, esign] }]).ok, true);
});

test("a directory that only shares a prefix is not the package", () => {
	assert.equal(check(["packages/events-suite/src/a.ts"]).ok, true);
});

test("parseChangesetPackages reads the front matter", () => {
	const body = `---\n"@semics-tech/emdash-events": minor\n'@semics-tech/emdash-esign': patch\n---\n\nAdds waitlists.\n`;
	assert.deepEqual(parseChangesetPackages(body), [events, esign]);
	assert.deepEqual(parseChangesetPackages("---\n---\n\nEmpty changeset.\n"), []);
});
