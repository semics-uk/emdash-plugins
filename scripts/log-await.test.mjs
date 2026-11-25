import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import test from "node:test";

import { serverFiles } from "./catch-check.mjs";

// T185: in a sandboxed plugin `ctx.log.*` is an RPC to the host, and a call left floating is dropped when the
// invocation ends (rc.36 on lmsc staging: vouchers.webhook_signature_failed never reached the log). Await it, return
// it, or go through `await report(...)`.
const CALL = /\b(?:ctx|run|deps\.ctx)\.log(?:\?\.|\.|\?\.\[|\[)\s*(?:warn|error|info|debug|level|\w+\])/;

test("T185 every ctx.log call is awaited or returned, and every report() is awaited", () => {
	const root = new URL("..", import.meta.url).pathname;
	const floating = serverFiles().flatMap((file) =>
		readFileSync(file, "utf8")
			.split("\n")
			.flatMap((line, i) => {
				const code = line.replace(/\/\/.*$/, "");
				const log = CALL.test(code) && !/\b(await|return)\s/.test(code);
				const rep = /(^|[^\w.])report\(\s*(opts\.log|input\.log|deps\.log|ctx\.log|deps\.ctx\.log|run\.log)/.test(code);
				return log || (rep && !/\bawait\s+report\(/.test(code)) ? [`${relative(root, file)}:${i + 1}`] : [];
			}),
	);
	assert.deepEqual(floating, [], "await the log call (a floating one is dropped in the sandbox)");
});
