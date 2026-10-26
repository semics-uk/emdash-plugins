#!/usr/bin/env node
// The product site (T124), https://plugins.semics.co.uk: what the plugins do, prices, terms of sale, refunds,
// privacy and contact details, the pages Paddle reviews before it approves the checkout domain. Plain HTML
// from `pages.mjs` into `dist/`, served as Workers static assets (`wrangler.jsonc`). No site generator.
//
//   node build.mjs      build into dist/

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NOT_FOUND, PAGES, SITE } from "./pages.mjs";

export const siteRoot = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(siteRoot, "../..");
export const distDir = join(siteRoot, "dist");

const NAV = [
	{ href: "/", label: "Plugins" },
	{ href: "/pricing", label: "Pricing" },
	{ href: SITE.docs, label: "Docs" },
	{ href: SITE.repo, label: "GitHub" },
];

const FOOTER = [
	{ href: "/terms", label: "Terms of sale" },
	{ href: "/refunds", label: "Refunds" },
	{ href: "/privacy", label: "Privacy" },
	{ href: "/contact", label: "Contact" },
];

// The docs site's colour tokens (apps/docs/build.mjs), so the two sites read as one.
const STYLE = `:root{--bg:#fff;--fg:#1d1d1f;--muted:#5a5a63;--line:#d9d9de;--accent:#1f5fbf;--code:#f4f4f6;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#141417;--fg:#ececf0;--muted:#a6a6b0;--line:#33333a;--accent:#8db4ff;--code:#1f1f24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,sans-serif}
a{color:var(--accent)}a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.skip{position:absolute;inset-inline-start:-999px}.skip:focus{inset-inline-start:8px;top:8px;background:var(--bg);padding:4px 8px;z-index:1}
.bar{max-width:1000px;margin:0 auto;padding:0 16px}
header{border-bottom:1px solid var(--line)}header .bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 24px;padding-block:12px}
.brand{font-weight:600;text-decoration:none;color:var(--fg)}header ul{display:flex;flex-wrap:wrap;gap:4px 20px;list-style:none;margin:0;padding:0}
header a[aria-current]{font-weight:600;color:var(--fg)}
main{display:block;padding-block:24px 48px}h1,h2,h3{line-height:1.25}h1{font-size:2rem;margin-top:0}
.lead{font-size:1.15rem;color:var(--muted);max-width:60ch}p,li{max-width:72ch}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin:24px 0}
.card{border:1px solid var(--line);border-radius:8px;padding:16px}.card h2,.card h3{margin-top:0;font-size:1.15rem}
.price{font-size:1.6rem;font-weight:600;margin:4px 0}.price small{font-size:.9rem;font-weight:400;color:var(--muted)}
.note{background:var(--code);border-radius:8px;padding:12px 16px}
code{background:var(--code);padding:1px 4px;border-radius:4px;font-size:.92em}
table{border-collapse:collapse;display:block;overflow-x:auto;max-width:100%}th,td{border:1px solid var(--line);padding:6px 8px;text-align:start;vertical-align:top}
footer{border-top:1px solid var(--line);color:var(--muted);font-size:.9em}footer .bar{padding-block:16px 32px}
footer ul{display:flex;flex-wrap:wrap;gap:4px 20px;list-style:none;margin:0 0 8px;padding:0}
`;

const escapeHtml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One page of the site: the shared header, footer and stylesheet around the page's own HTML. */
export function layout(page) {
	const link = ({ href, label }) =>
		`<li><a href="${href}"${href === page.path ? ' aria-current="page"' : ""}>${label}</a></li>`;
	return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(page.title)}</title>
<meta name="description" content="${escapeHtml(page.description)}">
<link rel="canonical" href="${SITE.origin}${page.path}">
<style>${STYLE}</style>
</head>
<body>
${page.review ? `<!-- Legal text: needs the lawyer's review before launch (docs/legal/brief.md §13, item 17). -->\n` : ""}<a class="skip" href="#main">Skip to content</a>
<header><div class="bar"><a class="brand" href="/">semics plugins for EmDash</a>
<nav aria-label="Main"><ul>${NAV.map(link).join("")}</ul></nav></div></header>
<main id="main"><div class="bar">
${page.body.trim()}
</div></main>
<footer><div class="bar">
<nav aria-label="Legal and contact"><ul>${FOOTER.map(link).join("")}</ul></nav>
<p>Support: <a href="mailto:${SITE.support}">${SITE.support}</a>. ${SITE.company.name}, registered in England and Wales, company number ${SITE.company.number}. Orders are processed by Paddle.com, our Merchant of Record.</p>
</div></footer>
</body>
</html>
`;
}

/** Security headers for every response (Workers static assets read `_headers`). */
const HEADERS = `/*
  Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  Referrer-Policy: strict-origin-when-cross-origin
  X-Content-Type-Options: nosniff
  Strict-Transport-Security: max-age=31536000
`;

/** Write every page, the 404 page and `_headers` into a fresh dist/. Returns the files written. */
export function build() {
	rmSync(distDir, { recursive: true, force: true });
	mkdirSync(distDir, { recursive: true });
	const files = [];
	for (const page of [...PAGES, NOT_FOUND]) {
		writeFileSync(join(distDir, page.file), layout(page));
		files.push(page.file);
	}
	writeFileSync(join(distDir, "_headers"), HEADERS);
	return files;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	console.log(`site: ${build().length} pages in dist/`);
}
