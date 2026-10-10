import assert from "node:assert/strict";
import { test } from "node:test";

import { buildBoard, parseTask, validate } from "./tasks.mjs";

const md = (fm) => `---\n${fm}\n---\n\n# body\n`;

const task = (id, deps = [], extra = {}) => ({
	id,
	title: `Task ${id}`,
	phase: 1,
	package: "events",
	edition: "free",
	status: "backlog",
	model: "sonnet-5.5",
	size: "S",
	depends_on: deps,
	spec: [],
	file: `${id}.md`,
	...extra,
});

test("parseTask reads scalars, quoted strings and arrays", () => {
	const t = parseTask(
		md('id: T001\ntitle: "Gates: lint, format"\nphase: 0\nstatus: backlog\ndepends_on: [T000, T003]\nspec: []'),
		"T001.md",
	);
	assert.equal(t.id, "T001");
	assert.equal(t.title, "Gates: lint, format");
	assert.equal(t.phase, 0);
	assert.deepEqual(t.depends_on, ["T000", "T003"]);
	assert.deepEqual(t.spec, []);
});

test("parseTask rejects a file without front matter", () => {
	assert.throws(() => parseTask("# no front matter", "x.md"), /front matter/);
});

test("validate accepts a consistent board", () => {
	assert.deepEqual(validate([task("T1"), task("T2", ["T1"])]), []);
});

test("validate reports unknown dependencies", () => {
	const errors = validate([task("T2", ["T9"])]);
	assert.match(errors.join("\n"), /T2 depends on unknown T9/);
});

test("validate reports duplicate ids", () => {
	assert.match(validate([task("T1"), task("T1")]).join("\n"), /duplicate id T1/);
});

test("validate reports cycles", () => {
	const errors = validate([task("T1", ["T3"]), task("T2", ["T1"]), task("T3", ["T2"])]);
	assert.match(errors.join("\n"), /cycle/);
});

test("validate rejects unknown models, statuses and sizes", () => {
	const errors = validate([task("T1", [], { model: "gpt", status: "doing", size: "XL" })]);
	assert.match(errors.join("\n"), /model/);
	assert.match(errors.join("\n"), /status/);
	assert.match(errors.join("\n"), /size/);
});

test("validate refuses work started before its dependencies are done", () => {
	const errors = validate([task("T1"), task("T2", ["T1"], { status: "in-progress" })]);
	assert.match(errors.join("\n"), /T2 is in-progress but T1 is backlog/);
});

test("buildBoard puts backlog tasks with finished dependencies in Ready", () => {
	const board = buildBoard([task("T1", [], { status: "done" }), task("T2", ["T1"]), task("T3", ["T2"])]);
	assert.deepEqual(board.columns.ready, ["T2"]);
	assert.deepEqual(board.columns.backlog, ["T3"]);
	assert.deepEqual(board.columns.done, ["T1"]);
});

test("buildBoard computes reverse dependencies and the critical path", () => {
	const board = buildBoard([
		task("T1", [], { size: "M" }),
		task("T2", ["T1"], { size: "L" }),
		task("T3", ["T1"], { size: "S" }),
		task("T4", ["T2", "T3"], { size: "S" }),
	]);
	assert.deepEqual(board.tasks.T1.unblocks, ["T2", "T3"]);
	assert.deepEqual(board.criticalPath, ["T1", "T2", "T4"]);
});
