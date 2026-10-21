// Playwright webServer entry. Gives every e2e run identical, freshly seeded state:
//   1. delete data.db* and uploads/
//   2. apply seed/seed.json with the EmDash CLI (migrates, then seeds: deterministic, no first-request race)
//   3. start the built server and keep it in the foreground
// On SIGTERM/SIGINT/exit the server and any workerd it spawned (same process group) are killed.
import { spawn, spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { applyBookingFixtures } from "./fixtures.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const port = process.env.PORT ?? "4401";

for (const target of ["data.db", "data.db-shm", "data.db-wal", "data.db-journal", "uploads"]) {
	rmSync(resolve(root, target), { recursive: true, force: true });
}

const seed = spawnSync(
	process.execPath,
	[resolve(root, "node_modules/emdash/dist/cli/index.mjs"), "seed"],
	{ cwd: root, stdio: "inherit" },
);
if (seed.status !== 0) {
	console.error("[e2e] seeding failed");
	process.exit(seed.status ?? 1);
}
applyBookingFixtures(root);

const server = spawn(process.execPath, [resolve(root, "dist/server/entry.mjs")], {
	cwd: root,
	stdio: "inherit",
	detached: true, // own process group so one signal reaches workerd too
	env: { ...process.env, PORT: port, HOST: "127.0.0.1" },
});

let stopping = false;
function stop(code = 0) {
	if (stopping) return;
	stopping = true;
	try {
		process.kill(-server.pid, "SIGTERM");
	} catch {}
	setTimeout(() => {
		try {
			process.kill(-server.pid, "SIGKILL");
		} catch {}
		process.exit(code);
	}, 2000).unref();
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) process.on(signal, () => stop(0));
process.on("exit", () => {
	try {
		process.kill(-server.pid, "SIGKILL");
	} catch {}
});
server.on("exit", (code) => {
	if (!stopping) process.exit(code ?? 1);
});
