// T103: every code snippet in the docs is run by this test, so a snippet cannot drift from the code.
//
//   js, ts      written to .snippets/ and imported: every import must resolve and the module must run.
//               An exported Astro config also runs the setup hook of every semics integration in it.
//   astro       compiled by Astro's compiler; every import must resolve, and each prop given to one of
//               the plugins' components must be one the component declares.
//   json        parsed; a seed file (it has `collections`) must pass EmDash's own `validateSeed`.
//   sh          each command is checked: a package to install must exist, a script must be one the
//               package defines, an environment variable must be one EmDash reads; `openssl` runs.
//   text        prose in a box (paths, sample output): not code, nothing to run.
//
// The protocol page's grammar and schema boxes are covered by docs/protocol/vectors.test.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { codeBlocks, docsRoot, PAGES, repoRoot } from "../build.mjs";

const PRODUCT_PACKAGES = ["events", "esign", "events-suite"];

/** Every Markdown file whose snippets this test runs (repo-relative). */
function sources() {
	const files = PAGES.map((p) => p.src).filter((src) => !src.startsWith("docs/protocol/"));
	for (const pkg of PRODUCT_PACKAGES) {
		files.push(`packages/${pkg}/README.md`);
		const listing = join(repoRoot, "packages", pkg, "listing");
		if (existsSync(listing)) {
			for (const f of readdirSync(listing)
				.filter((f) => f.endsWith(".md"))
				.sort()) {
				files.push(`packages/${pkg}/listing/${f}`);
			}
		}
	}
	return files.filter((src) => existsSync(join(repoRoot, src)));
}

const snippetDir = join(docsRoot, ".snippets");
const requireFromDocs = createRequire(join(docsRoot, "package.json"));
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function packageDirs() {
	const dirs = new Map();
	for (const base of ["packages", "apps"]) {
		for (const name of readdirSync(join(repoRoot, base))) {
			const file = join(repoRoot, base, name, "package.json");
			if (existsSync(file)) dirs.set(readJson(file).name, join(repoRoot, base, name));
		}
	}
	return dirs;
}
const PACKAGES = packageDirs();

/** Names a site may install: the products (Pro builds by private npm, §13) and what the playground uses. */
const INSTALLABLE = new Set([
	...["@semics-tech/emdash-events", "@semics-tech/emdash-esign", "@semics-tech/emdash-events-suite"],
	...["@semics-tech/emdash-events-pro", "@semics-tech/emdash-esign-pro"],
	...Object.keys(readJson(join(repoRoot, "apps/playground/package.json")).dependencies),
]);

/** Environment variables EmDash itself reads (each must appear in its build). */
function emdashReads(name) {
	const dist = join(dirname(requireFromDocs.resolve("emdash/package.json")), "dist");
	const grep = spawnSync("grep", ["-rlqF", name, dist]);
	return grep.status === 0;
}

const EMDASH_PLUGIN_COMMANDS = new Set(["validate", "build", "bundle", "dev", "login", "publish", "whoami", "switch"]);

function checkShell(text, src) {
	const problems = [];
	const here = dirname(join(repoRoot, src));
	const ownPackage = existsSync(join(here, "package.json")) ? readJson(join(here, "package.json")) : null;
	for (const raw of text.split("\n")) {
		const line = raw.replace(/\s+#.*$/, "").trim();
		if (!line || line.startsWith("#")) continue;
		const words = line.split(/\s+/);
		const env = /^(?:export\s+)?([A-Z][A-Z0-9_]*)=/.exec(line);
		if (env) {
			if (!emdashReads(env[1])) problems.push(`${env[1]} is not read by EmDash`);
			continue;
		}
		if (words[0] === "openssl") {
			const run = spawnSync(words[0], words.slice(1), { encoding: "utf8" });
			if (run.status !== 0) problems.push(`"${line}" failed: ${run.stderr}`);
			continue;
		}
		let args = words;
		if (args[0] === "corepack") args = ["pnpm", ...args.slice(2)];
		if (args[0] === "npx" && args[1] === "emdash-plugin") {
			if (!EMDASH_PLUGIN_COMMANDS.has(args[2])) problems.push(`emdash-plugin has no command ${args[2]}`);
			continue;
		}
		if (args[0] !== "pnpm" && args[0] !== "npm") {
			problems.push(`unknown command: ${line}`);
			continue;
		}
		if (args[1] === "add" || args[1] === "install" || args[1] === "i") {
			for (const name of args.slice(2).filter((a) => !a.startsWith("-"))) {
				if (!INSTALLABLE.has(name.replace(/@[^@/]+$/, ""))) problems.push(`unknown package ${name}`);
			}
			continue;
		}
		let pkg = ownPackage;
		const filter = args.indexOf("--filter");
		if (filter !== -1) {
			const dir = PACKAGES.get(args[filter + 1]);
			if (!dir) problems.push(`no workspace package ${args[filter + 1]}`);
			pkg = dir ? readJson(join(dir, "package.json")) : null;
			args = [...args.slice(0, filter), ...args.slice(filter + 2)];
		}
		const script = args[1] === "run" ? args[2] : args[1];
		const scripts = { ...readJson(join(repoRoot, "package.json")).scripts, ...(pkg?.scripts ?? {}) };
		if (!script || !(script in scripts)) problems.push(`no script "${script}" for: ${line}`);
	}
	return problems;
}

async function runModule(text, name, lang) {
	mkdirSync(snippetDir, { recursive: true });
	const file = join(snippetDir, `${name}.${lang === "ts" ? "mts" : "mjs"}`);
	writeFileSync(file, text);
	const mod = await import(pathToFileURL(file).href);
	const config = mod.default;
	const injected = [];
	for (const integration of config?.integrations ?? []) {
		if (!integration?.name?.startsWith("semics")) continue;
		integration.hooks["astro:config:setup"]({
			injectRoute: (route) => injected.push(route.pattern),
			updateConfig: () => {},
		});
	}
	return { mod, injected };
}

let compiler;
async function checkAstro(text) {
	compiler ??= await import(pathToFileURL(requireFromDocs.resolve("@astrojs/compiler-rs")).href);
	const problems = [];
	const result = compiler.transform(text, { filename: "Snippet.astro" });
	for (const d of result.diagnostics ?? []) if (d.severity === 1 || d.severity === "error") problems.push(d.text);
	const imports = [...text.matchAll(/^import\s+(?:(\w+)\s+from\s+)?(?:\{[^}]*\}\s+from\s+)?"([^"]+)";/gm)];
	for (const [, local, spec] of imports) {
		let path;
		try {
			path = requireFromDocs.resolve(spec);
		} catch {
			problems.push(`cannot resolve ${spec}`);
			continue;
		}
		if (!local || !path.endsWith(".astro")) continue;
		const component = readFileSync(path, "utf8");
		const declared = /interface Props\s*\{([\s\S]*?)\n\}/.exec(component)?.[1] ?? "";
		const props = new Set([...declared.matchAll(/^\s*(\w+)\??:/gm)].map((m) => m[1]));
		for (const tag of text.matchAll(new RegExp(`<${local}\\b([^>]*)/?>`, "g"))) {
			for (const [, prop] of tag[1].matchAll(/(\w+)=/g)) {
				if (!props.has(prop)) problems.push(`<${local}> has no prop ${prop}`);
			}
		}
	}
	return problems;
}

const RUNNABLE = new Set(["js", "ts", "astro", "json", "sh", "text"]);

test("every docs file has snippets, and every snippet is labelled with a language this test runs", () => {
	const unlabelled = [];
	for (const src of sources()) {
		for (const block of codeBlocks(readFileSync(join(repoRoot, src), "utf8"))) {
			if (!RUNNABLE.has(block.lang)) unlabelled.push(`${src}:${block.line} "${block.lang}"`);
		}
	}
	assert.deepEqual(unlabelled, []);
	const install = codeBlocks(readFileSync(join(repoRoot, "apps/docs/pages/install.md"), "utf8"));
	assert.ok(
		install.some((b) => b.lang === "json" && b.text.includes('"events"')),
		"install.md has the events seed",
	);
	assert.ok(
		install.some((b) => b.lang === "js" && b.text.includes("defineConfig")),
		"install.md has an astro.config",
	);
});

test("every snippet runs", async (t) => {
	rmSync(snippetDir, { recursive: true, force: true });
	let n = 0;
	for (const src of sources()) {
		for (const block of codeBlocks(readFileSync(join(repoRoot, src), "utf8"))) {
			if (block.lang === "text") continue;
			const where = `${src}:${block.line}`;
			const name = `${relative(repoRoot, join(repoRoot, src)).replace(/[^\w]+/g, "-")}-${block.line}`;
			n++;
			await t.test(`${where} (${block.lang})`, async () => {
				if (block.lang === "js" || block.lang === "ts") {
					const { mod, injected } = await runModule(block.text, name, block.lang);
					assert.ok(mod, where);
					if (/defineConfig/.test(block.text)) {
						assert.ok(Array.isArray(mod.default?.integrations), `${where}: exports an Astro config`);
						assert.ok(injected.length > 0 || !/semics|events|esign/i.test(block.text), `${where}: injects pages`);
					}
				} else if (block.lang === "astro") {
					assert.deepEqual(await checkAstro(block.text), [], where);
				} else if (block.lang === "json") {
					const data = JSON.parse(block.text);
					if (data.collections) {
						const { validateSeed } = await import(pathToFileURL(requireFromDocs.resolve("emdash/seed")).href);
						const result = validateSeed(data);
						assert.deepEqual(result.errors, [], `${where}: seed is valid`);
					}
				} else if (block.lang === "sh") {
					assert.deepEqual(checkShell(block.text, src), [], where);
				}
			});
		}
	}
	assert.ok(n > 0, "the docs have snippets");
	rmSync(snippetDir, { recursive: true, force: true });
});
