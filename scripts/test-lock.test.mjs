import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { acquireTestLock, lockPathFor } from "./test-lock.mjs";

const scratch = [];
after(() => {
	for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});
const tempDir = () => {
	const dir = mkdtempSync(join(tmpdir(), "test-lock-"));
	scratch.push(dir);
	return dir;
};
const quiet = () => {};

test("acquiring a free lock records this process and release removes it", async () => {
	const lock = join(tempDir(), "semics-test.lock");
	const release = await acquireTestLock(lock, { log: quiet });
	assert.equal(readFileSync(join(lock, "pid"), "utf8").trim(), String(process.pid));
	release();
	assert.equal(existsSync(lock), false);
});

// Another live process holds a lock when its pid file names one: the test runner's parent is live.
const heldByParent = async (lock) => {
	const release = await acquireTestLock(lock, { log: quiet });
	writeFileSync(join(lock, "pid"), `${process.ppid}\n`);
	return release;
};

test("a lock held by a live process makes the next run wait, then time out", async () => {
	const lock = join(tempDir(), "semics-test.lock");
	const release = await heldByParent(lock);
	const started = Date.now();
	await assert.rejects(acquireTestLock(lock, { timeoutMs: 300, pollMs: 50, log: quiet }), /another test run/i);
	assert.ok(Date.now() - started >= 300);
	release();
});

test("the waiting run gets the lock as soon as the holder releases it", async () => {
	const lock = join(tempDir(), "semics-test.lock");
	const release = await heldByParent(lock);
	setTimeout(release, 150);
	const second = await acquireTestLock(lock, { timeoutMs: 5000, pollMs: 25, log: quiet });
	assert.equal(readFileSync(join(lock, "pid"), "utf8").trim(), String(process.pid));
	second();
});

test("a lock left by a dead process is taken over", async () => {
	const lock = join(tempDir(), "semics-test.lock");
	await acquireTestLock(lock, { log: quiet });
	writeFileSync(join(lock, "pid"), "999999\n");
	const release = await acquireTestLock(lock, { timeoutMs: 500, pollMs: 25, log: quiet });
	assert.equal(readFileSync(join(lock, "pid"), "utf8").trim(), String(process.pid));
	release();
});

test("every worktree shares the main checkout's lock", () => {
	const main = tempDir();
	const worktree = tempDir();
	writeFileSync(join(worktree, ".git"), `gitdir: ${join(main, ".git", "worktrees", "agent-x")}\n`);
	assert.equal(lockPathFor(worktree), join(main, ".git", "semics-test.lock"));
	assert.equal(lockPathFor(main), join(main, ".git", "semics-test.lock"));
});

test("taking the lock again from the process that holds it is a no-op (vitest projects)", async () => {
	const lock = join(tempDir(), "semics-test.lock");
	const release = await acquireTestLock(lock, { log: quiet });
	const inner = await acquireTestLock(lock, { timeoutMs: 100, pollMs: 25, log: quiet });
	inner();
	assert.equal(existsSync(lock), true);
	release();
	assert.equal(existsSync(lock), false);
});
