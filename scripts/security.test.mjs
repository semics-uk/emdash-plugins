// T100 security review: static checks over the sandboxed cores' sources.
//
// 1. A sandboxed route that throws reaches public callers as `400 ROUTE_ERROR` with the raw
//    `Error.message` (EmDash dispatch, T034 review finding 10). So every error the cores and the shared
//    library construct must be a fixed string, or interpolate only values on the allowlist below
//    (constants, a type or kind name, a time zone, an admin-typed amount): never a token, a secret,
//    an email or other stored personal data.
// 2. The E-sign core imports the UI's `src/astro/lib/markdown.ts` to render the signed PDF (T117), so
//    that file must stay free of imports: anything it pulled in would land in the sandbox bundle.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = new URL("..", import.meta.url).pathname;
/** Native UI halves: they never run in the sandbox. */
const UI_DIRS = new Set(["astro", "client", "ui", "integration"]);

function sources(dir, out = []) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (!UI_DIRS.has(name)) sources(path, out);
		} else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) out.push(path);
	}
	return out;
}

const ALLOWED = new Set([
	"TOKEN_BYTES",
	"LINK_SECRET_BYTES",
	"MIN_LINK_TTL_MS",
	"MAX_LINK_TTL_MS",
	"CLIENT_SECRET_BYTES",
	"MASTER_KEY_MIN_BYTES",
	"CLIENT_ID_RANDOM_CHARS",
	"ESIGN_SECRET_BYTES",
	"type",
	"schema.error",
	"doc.kind",
	"e.uid",
	"e.timeZone",
	"zone",
	"timeZone",
	"minor",
	"amount",
	"currency",
	// A template placeholder name (`TemplateError`), never its value.
	"field",
]);

test("T100 errors built in sandboxed core code interpolate no token, secret or personal data", () => {
	const files = ["packages/events/src", "packages/esign/src", "packages/shared/src"].flatMap((d) =>
		sources(join(root, d)),
	);
	assert.ok(files.length > 50);
	const bad = [];
	for (const file of files) {
		const text = readFileSync(file, "utf8");
		for (const match of text.matchAll(/new [A-Za-z]*Error\(\s*`([^`]*)`/g)) {
			for (const [, expr] of match[1].matchAll(/\$\{([^}]*)\}/g)) {
				if (!ALLOWED.has(expr.trim())) bad.push(`${file.slice(root.length)}: \${${expr}}`);
			}
		}
		for (const match of text.matchAll(/new [A-Za-z]*Error\(\s*([A-Za-z_][\w.]*)\s*[,)]/g)) {
			if (!ALLOWED.has(match[1])) bad.push(`${file.slice(root.length)}: Error(${match[1]})`);
		}
	}
	assert.deepEqual(bad, []);
});

test("T100 (T117) the markdown parser the E-sign core imports for the signed PDF imports nothing", () => {
	const text = readFileSync(join(root, "packages/esign/src/astro/lib/markdown.ts"), "utf8");
	assert.doesNotMatch(text, /^\s*import\s/m);
	assert.doesNotMatch(text, /^\s*export\s+(\*|\{[^}]*\})\s+from\s/m);
	assert.doesNotMatch(text, /\bimport\s*\(/);
	assert.doesNotMatch(text, /\brequire\s*\(/);
});
