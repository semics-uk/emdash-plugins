// land-pro.sh lands a Pro task's commits in the separate Pro repo (R40) after land.sh lands the
// public side. These tests run it against throwaway git repos only.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./orchestrator/land-pro.sh", import.meta.url));
const scratch = [];
after(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd, ...args) => {
	const r = spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.test", ...args], { cwd, encoding: "utf8" });
	assert.equal(r.status, 0, r.stderr);
	return r.stdout.trim();
};

/** A Pro repo with one commit on main, and a worktree for agent `x` on branch `pro-agent-x`. */
function setup({ worktree = true } = {}) {
	const root = mkdtempSync(join(tmpdir(), "land-pro-"));
	scratch.push(root);
	const pro = join(root, "pro");
	const worktrees = join(root, "wt");
	spawnSync("mkdir", ["-p", pro, worktrees]);
	git(pro, "init", "-q", "-b", "main");
	writeFileSync(join(pro, "README.md"), "pro\n");
	git(pro, "add", "-A");
	git(pro, "commit", "-qm", "init");
	const wt = join(worktrees, "agent-x");
	if (worktree) {
		git(pro, "worktree", "add", "-q", "-b", "pro-agent-x", wt, "main");
		writeFileSync(join(wt, "feature.txt"), "pro feature\n");
		git(wt, "add", "-A");
		git(wt, "commit", "-qm", "feat(T999): pro feature");
	}
	return { pro, wt, env: { ...process.env, SEMICS_PRO_REPO: pro, SEMICS_PRO_WORKTREES: worktrees } };
}

const land = (env) => spawnSync("zsh", [script, "x", "T999"], { env, encoding: "utf8" });

test("lands the Pro worktree's commits on Pro main and removes the worktree and branch", () => {
	const { pro, wt, env } = setup();
	const r = land(env);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.match(r.stdout, /LANDED PRO T999/);
	assert.equal(git(pro, "log", "-1", "--format=%s", "main"), "feat(T999): pro feature");
	assert.equal(existsSync(wt), false);
	assert.equal(git(pro, "branch", "--list", "pro-agent-x"), "");
});

test("rebases onto a Pro main that moved on, then fast-forwards", () => {
	const { pro, env } = setup();
	writeFileSync(join(pro, "other.txt"), "other\n");
	git(pro, "add", "-A");
	git(pro, "commit", "-qm", "other work");
	const r = land(env);
	assert.equal(r.status, 0, r.stdout + r.stderr);
	assert.deepEqual(git(pro, "log", "--format=%s", "main").split("\n"), ["feat(T999): pro feature", "other work", "init"]);
});

test("does nothing for a task without a Pro worktree", () => {
	const { pro, env } = setup({ worktree: false });
	const r = land(env);
	assert.equal(r.status, 0, r.stderr);
	assert.match(r.stdout, /no Pro worktree/);
	assert.equal(git(pro, "log", "-1", "--format=%s", "main"), "init");
});

test("refuses a dirty Pro worktree and leaves Pro main alone", () => {
	const { pro, wt, env } = setup();
	writeFileSync(join(wt, "uncommitted.txt"), "x\n");
	const r = land(env);
	assert.notEqual(r.status, 0);
	assert.match(r.stdout + r.stderr, /DIRTY Pro worktree/);
	assert.equal(git(pro, "log", "-1", "--format=%s", "main"), "init");
});
