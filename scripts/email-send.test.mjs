import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import test from "node:test";

import { serverFiles } from "./catch-check.mjs";

// T185 (#79 item 5): a failed email never fails a booking, a payment or a signature, because no route sends mail
// itself. Routes and webhooks queue rows in the outbox, and only the cron drain hands them to `ctx.email`. A failure
// there is retried, then logged (outbox.send_failed, outbox.gave_up), and the booking is untouched.
const DRAINS = new Set([
	"packages/shared/src/outbox.ts",
	"packages/events/src/emails/outbox.ts",
	"packages/esign/src/emails/outbox.ts",
]);
const SENDS = /\bctx\.email\b|\bemail\??\.send\(/;

test("T185 only the outbox drains touch ctx.email: no route sends mail itself", () => {
	const root = new URL("..", import.meta.url).pathname;
	const senders = serverFiles()
		.map((file) => relative(root, file))
		.filter((file) => SENDS.test(readFileSync(new URL(`../${file}`, import.meta.url), "utf8")));
	assert.deepEqual(
		senders.filter((file) => !DRAINS.has(file)),
		[],
		"queue the message with enqueueEmail (or the package's outbox row) instead of sending it from a route",
	);
	for (const drain of DRAINS) assert.ok(senders.includes(drain), `${drain} still drains the outbox`);
});
