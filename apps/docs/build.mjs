#!/usr/bin/env node
// The docs site (T103): Markdown pages in `pages/`, plus the repo's translation guide and protocol,
// rendered to plain HTML in `dist/` with `marked`. No site generator: one template, one stylesheet.
//
//   node build.mjs            build into dist/, exit 1 on any broken link or anchor
//
// Links are checked while rendering: a link to another page must name a page of the site (and an
// anchor that page has), a link to a repo file must point at a file that exists (it becomes a
// GitHub link), and an image must exist (it is copied next to the pages).

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

export const docsRoot = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(docsRoot, "../..");
const REPO_URL = "https://github.com/semics-uk/emdash-plugins/blob/main/";

/** The site's pages, in navigation order. `src` is relative to the repo root. */
export const PAGES = [
	{ src: "apps/docs/pages/index.md", out: "index.html", nav: "Overview" },
	{ src: "apps/docs/pages/install.md", out: "install.html", nav: "Install" },
	{ src: "apps/docs/pages/configure.md", out: "configure.html", nav: "Configure" },
	{ src: "apps/docs/pages/events.md", out: "events.html", nav: "Events guide" },
	{ src: "apps/docs/pages/payments.md", out: "payments.html", nav: "Paid tickets (Pro)" },
	{ src: "apps/docs/pages/esign.md", out: "esign.html", nav: "E-sign guide" },
	{ src: "apps/docs/pages/waivers.md", out: "waivers.html", nav: "Waivers (suite)" },
	{ src: "apps/docs/pages/site-pages.md", out: "site-pages.html", nav: "Pages and components" },
	{ src: "apps/docs/pages/privacy.md", out: "privacy.html", nav: "Data and retention" },
	{ src: "apps/docs/pages/accessibility.md", out: "accessibility.html", nav: "Accessibility" },
	{ src: "apps/docs/pages/translations.md", out: "translations.html", nav: "Translations" },
	{ src: "docs/i18n.md", out: "i18n.html", nav: "Adding a language" },
	{ src: "apps/docs/pages/editions.md", out: "editions.html", nav: "Free and Pro" },
	{ src: "apps/docs/pages/troubleshooting.md", out: "troubleshooting.html", nav: "Troubleshooting" },
	{ src: "apps/docs/pages/faq.md", out: "faq.html", nav: "FAQ" },
	{ src: "docs/protocol/esign-intent-v1.md", out: "protocol.html", nav: "Signing protocol" },
];

const IMAGE = /\.(png|jpe?g|webp|svg)$/i;

/** GitHub's heading anchors: lower case, punctuation dropped, spaces to hyphens. */
export function slugify(text) {
	return text
		.toLowerCase()
		.replace(/<[^>]+>/g, "")
		.replace(/[^\p{L}\p{N}\s_-]/gu, "")
		.trim()
		.replace(/\s/g, "-");
}

const plain = (text) =>
	text
		.replace(/`([^`]*)`/g, "$1")
		.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
		.replace(/[*_]/g, "");

/** Every fenced code block of a Markdown text, with the line it starts on. */
export function codeBlocks(markdown) {
	const blocks = [];
	const lines = markdown.split("\n");
	let open = null;
	for (let i = 0; i < lines.length; i++) {
		const fence = /^(\s*)(```+|~~~+)\s*([^\s`]*)\s*(.*)$/.exec(lines[i]);
		if (!open && fence) {
			open = { indent: fence[1].length, fence: fence[2], lang: fence[3], info: fence[4], line: i + 1, body: [] };
		} else if (open && fence?.[2].startsWith(open.fence) && fence[3] === "" && fence[4] === "") {
			blocks.push({
				lang: open.lang,
				info: open.info,
				line: open.line,
				text: open.body.map((l) => l.slice(Math.min(open.indent, l.length - l.trimStart().length))).join("\n"),
			});
			open = null;
		} else if (open) {
			open.body.push(lines[i]);
		}
	}
	return blocks;
}

/** The anchors (heading ids) of a Markdown text. */
export function anchorsOf(markdown) {
	const ids = new Set();
	const counts = new Map();
	let inFence = false;
	for (const line of markdown.split("\n")) {
		if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
		const m = !inFence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
		if (!m) continue;
		const base = slugify(plain(m[2]));
		const n = counts.get(base) ?? 0;
		counts.set(base, n + 1);
		ids.add(n === 0 ? base : `${base}-${n}`);
	}
	return ids;
}

const escapeHtml = (s) =>
	String(s).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

/**
 * Builds the site. Returns the rendered pages and every link problem found; writes `outDir` unless
 * `write` is false.
 */
export function buildSite({ outDir = join(docsRoot, "dist"), write = true } = {}) {
	const problems = [];
	const sources = PAGES.map((p) => {
		const file = join(repoRoot, p.src);
		const markdown = existsSync(file) ? readFileSync(file, "utf8") : null;
		if (markdown === null) problems.push(`${p.src}: page is missing`);
		return { ...p, file, markdown: markdown ?? "", anchors: anchorsOf(markdown ?? "") };
	});
	const byFile = new Map(sources.map((s) => [s.file, s]));
	const assets = new Map();

	const resolveHref = (page, href, { image = false } = {}) => {
		if (/^(https?:|mailto:)/.test(href)) return href;
		const [path, anchor] = href.split("#");
		if (path === "") {
			if (!page.anchors.has(anchor)) problems.push(`${page.src}: no heading for #${anchor}`);
			return href;
		}
		const target = resolve(dirname(page.file), decodeURIComponent(path));
		const other = byFile.get(target);
		if (other) {
			if (anchor && !other.anchors.has(anchor))
				problems.push(`${page.src}: ${other.src} has no heading for #${anchor}`);
			return other.out + (anchor ? `#${anchor}` : "");
		}
		if (!target.startsWith(repoRoot + sep) || !existsSync(target)) {
			problems.push(`${page.src}: broken link ${href}`);
			return href;
		}
		const rel = relative(repoRoot, target).split(sep).join("/");
		if (image || IMAGE.test(target)) {
			const name = `assets/${rel.replace(/^packages\//, "").replaceAll("/", "-")}`;
			assets.set(name, target);
			return name;
		}
		return REPO_URL + rel + (anchor ? `#${anchor}` : "");
	};

	const rendered = sources.map((page) => {
		const counts = new Map();
		const marked = new Marked({ gfm: true });
		marked.use({
			renderer: {
				heading(text, level, raw) {
					const base = slugify(plain(raw));
					const n = counts.get(base) ?? 0;
					counts.set(base, n + 1);
					const id = n === 0 ? base : `${base}-${n}`;
					return `<h${level} id="${id}"><a class="anchor" href="#${id}" aria-hidden="true" tabindex="-1">#</a>${text}</h${level}>\n`;
				},
				link(href, title, text) {
					const to = resolveHref(page, href);
					return `<a href="${escapeHtml(to)}"${title ? ` title="${escapeHtml(title)}"` : ""}>${text}</a>`;
				},
				image(href, title, text) {
					const to = resolveHref(page, href, { image: true });
					return `<img src="${escapeHtml(to)}" alt="${escapeHtml(text)}" loading="lazy"${title ? ` title="${escapeHtml(title)}"` : ""}>`;
				},
			},
		});
		const body = marked.parse(page.markdown);
		const title = /^#\s+(.*)$/m.exec(page.markdown)?.[1] ?? page.nav;
		return { ...page, title: plain(title), html: layout({ page, title: plain(title), body }) };
	});

	if (write) {
		rmSync(outDir, { recursive: true, force: true });
		mkdirSync(join(outDir, "assets"), { recursive: true });
		for (const page of rendered) writeFileSync(join(outDir, page.out), page.html);
		for (const [name, from] of assets) copyFileSync(from, join(outDir, name));
		writeFileSync(join(outDir, "style.css"), STYLE);
	}
	return { pages: rendered, assets, problems };
}

function layout({ page, title, body }) {
	const nav = PAGES.map(
		(p) => `<li><a href="${p.out}"${p.out === page.out ? ' aria-current="page"' : ""}>${escapeHtml(p.nav)}</a></li>`,
	).join("");
	return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} · semics plugins for EmDash</title>
<link rel="stylesheet" href="style.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header><a class="brand" href="index.html">semics plugins for EmDash</a></header>
<div class="wrap">
<nav aria-label="Documentation"><ul>${nav}</ul></nav>
<main id="main">
${body}
<footer><p>Source: <a href="${REPO_URL}${page.src}">${escapeHtml(basename(page.src))}</a>. MIT licence.</p></footer>
</main>
</div>
</body>
</html>
`;
}

const STYLE = `:root{--bg:#fff;--fg:#1d1d1f;--muted:#5a5a63;--line:#d9d9de;--accent:#1f5fbf;--code:#f4f4f6}
@media (prefers-color-scheme:dark){:root{--bg:#141417;--fg:#ececf0;--muted:#a6a6b0;--line:#33333a;--accent:#8db4ff;--code:#1f1f24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
a{color:var(--accent)}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.skip{position:absolute;inset-inline-start:-999px}.skip:focus{inset-inline-start:8px;top:8px;background:var(--bg);padding:4px 8px}
header{border-bottom:1px solid var(--line);padding:12px 16px}.brand{font-weight:600;text-decoration:none;color:var(--fg)}
.wrap{display:flex;gap:32px;max-width:1100px;margin:0 auto;padding:16px}
nav{flex:0 0 200px}nav ul{list-style:none;margin:0;padding:0}nav li{margin:4px 0}nav a[aria-current]{font-weight:600}
main{flex:1;min-width:0}h1,h2,h3{line-height:1.25}.anchor{margin-inline-end:6px;text-decoration:none;opacity:.35;font-weight:400}
code{background:var(--code);padding:1px 4px;border-radius:4px;font-size:.92em}pre{background:var(--code);padding:12px;overflow:auto;border-radius:6px}pre code{padding:0}
table{border-collapse:collapse;display:block;overflow:auto}th,td{border:1px solid var(--line);padding:6px 8px;text-align:start;vertical-align:top}
img{max-width:100%;height:auto;border:1px solid var(--line);border-radius:6px}footer{margin-top:48px;color:var(--muted);font-size:.9em}
@media (max-width:760px){.wrap{flex-direction:column}nav{flex:none}}
`;

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const { pages, problems } = buildSite();
	for (const problem of problems) console.error(`✖ ${problem}`);
	if (problems.length) process.exit(1);
	console.log(`docs: ${pages.length} pages in ${relative(process.cwd(), join(docsRoot, "dist")) || "dist"}`);
}
