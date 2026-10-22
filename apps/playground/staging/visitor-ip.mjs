// Does the visitor's IP reach the core on Cloudflare? (T111, T056 follow-up.) The per-IP checkout
// limit counts bookings by `ipHash`, a salted hash of the address the core was given; with no address
// every visitor shares the hash of "unknown" and the limit is one bucket for the whole site.
//
//   node staging/visitor-ip.mjs <baseURL> [--d1 remote|local]
//
// books one free ticket through the real no-JS checkout (the page calls the core in-process, S2),
// reads the booking and the site's IP salt from D1 with wrangler, and checks the stored hash is this
// runner's address (from Cloudflare's /cdn-cgi/trace) or at least not "unknown".
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The core's `hashIp` (packages/shared/src/ratelimit.ts): SHA-256 of `salt:ip`, first 16 bytes, hex. */
export async function ipHash(ip, salt) {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
	return Buffer.from(new Uint8Array(digest).slice(0, 16)).toString("hex");
}

/** @param {{ stored: string, salt: string, ip?: string }} input */
export async function checkVisitorIp({ stored, salt, ip }) {
	if (stored === (await ipHash("unknown", salt))) return { ok: false, reason: "unknown" };
	if (!ip) return { ok: true, reason: "not-unknown" };
	return stored === (await ipHash(ip, salt)) ? { ok: true, reason: "matches" } : { ok: false, reason: "mismatch" };
}

function d1(root, mode, sql) {
	const out = execFileSync(
		process.execPath,
		[
			resolve(root, "node_modules/wrangler/bin/wrangler.js"),
			"d1",
			"execute",
			"semics-staging-playground",
			`--${mode}`,
			"--json",
			"--command",
			sql,
		],
		{ cwd: root, encoding: "utf8", env: { ...process.env, CLOUDFLARE_ENV: process.env.CLOUDFLARE_ENV ?? "staging" } },
	);
	return JSON.parse(out)[0]?.results ?? [];
}

async function bookOne(baseURL) {
	const body = await (await fetch(`${baseURL}/_emdash/api/plugins/semics-events/public/events`)).json();
	const event = body?.data?.events?.find((e) => e.slug === "sydney-conference");
	if (!event) throw new Error("sydney-conference is not listed");
	const res = await fetch(`${baseURL}/_events/checkout`, {
		method: "POST",
		redirect: "manual",
		headers: { "content-type": "application/x-www-form-urlencoded", origin: baseURL },
		body: new URLSearchParams({
			eventId: event.eventId,
			"qty:tt_sydney_pass": "1",
			name: "IP Check",
			email: `ip-check-${Date.now().toString(36)}@example.com`,
			idempotencyKey: `ip-check-${crypto.randomUUID().replaceAll("-", "")}`,
		}),
	});
	const ref = new URL(res.headers.get("location") ?? "/", baseURL).searchParams.get("ref");
	if (res.status !== 303 || !ref) throw new Error(`checkout did not book: HTTP ${res.status} ${res.headers.get("location")}`);
	return ref;
}

async function runnerIp(baseURL) {
	try {
		const text = await (await fetch(`${baseURL}/cdn-cgi/trace`)).text();
		return /^ip=(.+)$/m.exec(text)?.[1]?.trim();
	} catch {
		return undefined;
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const args = process.argv.slice(2);
	const baseURL = args.find((a) => a.startsWith("http"));
	const mode = args.includes("--d1") ? args[args.indexOf("--d1") + 1] : "remote";
	if (!baseURL || !["remote", "local"].includes(mode)) {
		throw new Error("usage: node staging/visitor-ip.mjs <baseURL> [--d1 remote|local]");
	}
	const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
	const ref = await bookOne(baseURL);
	const bookings = d1(
		root,
		mode,
		`SELECT data FROM _plugin_storage WHERE plugin_id = 'semics-events' AND collection = 'bookings' AND json_extract(data, '$.ref') = '${ref.replace(/[^0-9A-Z]/g, "")}'`,
	);
	const stored = JSON.parse(bookings[0]?.data ?? "{}").ipHash;
	const [saltRow] = d1(root, mode, "SELECT value FROM options WHERE name = 'plugin:semics-events:settings:ipSalt'");
	const salt = saltRow ? JSON.parse(saltRow.value) : undefined;
	if (!stored || !salt) throw new Error(`booking ${ref} has no ipHash or the site has no ipSalt (a Turnstile secret salts instead)`);
	const ip = await runnerIp(baseURL);
	const verdict = await checkVisitorIp({ stored, salt, ip });
	console.log(JSON.stringify({ ref, runnerIpKnown: Boolean(ip), ...verdict }));
	process.exit(verdict.ok ? 0 : 1);
}
