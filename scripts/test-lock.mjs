/**
 * One test run at a time on this machine, across the main checkout and every agent worktree.
 *
 * Each package's vitest config uses this as `globalSetup`, so any `vitest run` (inside `pnpm verify`
 * or on its own) waits for the run before it. workerd sandboxes are heavy enough that two suites at
 * once ran the machine out of memory. The lock is a directory inside the main checkout's `.git`,
 * which all worktrees share; a lock left by a dead process is taken over.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The shared lock path for a checkout: `<main .git>/semics-test.lock`. */
export function lockPathFor(root) {
	const dotGit = join(root, ".git");
	if (existsSync(dotGit) && statSync(dotGit).isFile()) {
		// A worktree's `.git` file points at `<main .git>/worktrees/<name>`.
		const gitdir = readFileSync(dotGit, "utf8")
			.match(/^gitdir:\s*(.+)$/m)?.[1]
			?.trim();
		if (gitdir) return join(dirname(dirname(resolve(root, gitdir))), "semics-test.lock");
	}
	return join(dotGit, "semics-test.lock");
}

function heldByThisProcess(lock) {
	try {
		return Number(readFileSync(join(lock, "pid"), "utf8").trim()) === process.pid;
	} catch {
		return false;
	}
}

function holderAlive(lock) {
	let pid;
	try {
		pid = Number(readFileSync(join(lock, "pid"), "utf8").trim());
	} catch {
		return true; // being created right now: treat as held
	}
	if (!Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}

/** Wait for the lock and take it; resolves to a release function. */
export async function acquireTestLock(
	lock = lockPathFor(repoRoot),
	{ timeoutMs = 45 * 60_000, pollMs = 2000, log = console.log } = {},
) {
	const deadline = Date.now() + timeoutMs;
	let announced = false;
	for (;;) {
		try {
			mkdirSync(lock);
			writeFileSync(join(lock, "pid"), `${process.pid}\n`);
			return () => rmSync(lock, { recursive: true, force: true });
		} catch (error) {
			if (error.code !== "EEXIST") throw error;
		}
		if (heldByThisProcess(lock)) return () => {};
		if (!holderAlive(lock)) {
			rmSync(lock, { recursive: true, force: true });
			continue;
		}
		if (Date.now() >= deadline) {
			throw new Error(`Timed out waiting for another test run to finish (lock: ${lock})`);
		}
		if (!announced) {
			log(`Waiting for another test run on this machine to finish (lock: ${lock})`);
			announced = true;
		}
		await new Promise((done) => setTimeout(done, pollMs));
	}
}

/** Vitest `globalSetup`: hold the lock for the whole run. */
export default async function setup() {
	if (process.env.SEMICS_TEST_LOCK === "0") return undefined;
	return acquireTestLock();
}
