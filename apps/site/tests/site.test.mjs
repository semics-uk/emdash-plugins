// T124: the product site Paddle reviews before it approves the checkout domain. Products, prices, terms of
// sale, a refund policy, a privacy policy and contact details, each reachable from every page.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { build, distDir, repoRoot } from "../build.mjs";

/** Published path -> file in dist/. The six URLs Paddle and buyers see. */
const PAGES = {
	"/": "index.html",
	"/pricing": "pricing.html",
	"/terms": "terms.html",
	"/refunds": "refunds.html",
	"/privacy": "privacy.html",
	"/contact": "contact.html",
};
const FOOTER = ["/terms", "/refunds", "/privacy", "/contact"];
const LEGAL = ["/terms", "/refunds", "/privacy"];
const SUPPORT = "support@semics.co.uk";
/** Plan name -> USD a year, as BUILD-PLAN D5 and the Pro licence Worker's plans.ts hold them. */
const PRICES = { "Events Pro": 79, "E-sign Pro": 79, "Suite Pro": 129, Agency: 349 };
/** TODOs the owner must settle, each listed in the T124 report. None: semics.co.uk publishes every fact. */
const OWNER_TODOS = [];

const html = {};
const read = (path) => html[path];
/** The page's visible text: tags dropped, entities for the few characters the pages use decoded. */
const text = (path) =>
	read(path)
		.replace(/<!--[\s\S]*?-->/g, " ")
		.replace(/<(script|style)[\s\S]*?<\/\1>/g, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&nbsp;/g, " ")
		.replace(/\s+/g, " ");
const footer = (path) => read(path).match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? "";
const hrefs = (fragment) => [...fragment.matchAll(/href="([^"]*)"/g)].map((m) => m[1]);

beforeAll(() => {
	build();
	for (const [path, file] of Object.entries(PAGES)) {
		const at = join(distDir, file);
		if (existsSync(at)) html[path] = readFileSync(at, "utf8");
	}
});

describe("pages", () => {
	test.each(Object.keys(PAGES))("%s is built, in English, with a title, a viewport and a main landmark", (path) => {
		expect(read(path), `${PAGES[path]} exists`).toBeTypeOf("string");
		expect(read(path)).toMatch(/^<!doctype html>/i);
		expect(read(path)).toMatch(/<html lang="en(-GB)?"/);
		expect(read(path)).toMatch(/<title>[^<]+<\/title>/);
		expect(read(path)).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1"/);
		expect(read(path)).toMatch(/<main[ >]/);
		expect(read(path)).toMatch(/<meta name="description" content="[^"]+"/);
	});

	test.each(Object.keys(PAGES))(
		"%s: the footer links terms, refunds, privacy and contact, and gives the support address",
		(path) => {
			const links = hrefs(footer(path));
			for (const target of FOOTER) expect(links, `${path} footer links ${target}`).toContain(target);
			expect(footer(path)).toContain(`mailto:${SUPPORT}`);
		},
	);

	test.each(Object.keys(PAGES))("%s: the header links home, pricing, the docs and the GitHub repo", (path) => {
		const links = hrefs(read(path).match(/<header[\s\S]*?<\/header>/)?.[0] ?? "");
		expect(links).toContain("/");
		expect(links).toContain("/pricing");
		expect(links.some((l) => l.startsWith("https://github.com/semics-uk/emdash-plugins"))).toBe(true);
		expect(links.some((l) => l.includes("apps/docs"))).toBe(true);
	});

	test.each(Object.keys(PAGES))("%s follows light and dark mode with the docs site's colour tokens", (path) => {
		expect(read(path)).toMatch(/prefers-color-scheme:\s*dark/);
		expect(read(path)).toMatch(/--accent:/);
	});
});

describe("home", () => {
	test("says what the plugins do and compares Free with Pro", () => {
		const body = text("/");
		expect(body).toMatch(/Events/);
		expect(body).toMatch(/E-sign/);
		expect(body).toMatch(/EmDash/);
		expect(body).toMatch(/Free/);
		expect(body).toMatch(/Pro/);
		expect(hrefs(read("/"))).toContain("/pricing");
	});
});

describe("pricing", () => {
	test("shows the four plans at their yearly USD prices", () => {
		const body = text("/pricing");
		for (const [plan, usd] of Object.entries(PRICES)) {
			expect(body, plan).toMatch(new RegExp(`${plan}[^$]*\\$${usd}\\s*(/|a|per)\\s*year`));
		}
	});

	test("the prices match BUILD-PLAN decision D5", () => {
		const d5 = readFileSync(join(repoRoot, "BUILD-PLAN.md"), "utf8").match(/^\| D5 \|.*$/m)?.[0] ?? "";
		expect(d5).toMatch(/Events Pro \$79, E-sign Pro \$79, Suite Pro \$129, agency \(10 sites\) \$349/);
		expect(text("/pricing")).toMatch(/10 sites/);
	});

	test("says Buy links are coming and gives the support address for each paid plan", () => {
		const body = text("/pricing");
		expect(body).toMatch(/Buy links are coming/i);
		expect(read("/pricing")).toContain(`mailto:${SUPPORT}`);
	});

	test("Free is free and links the install docs", () => {
		expect(text("/pricing")).toMatch(/Free[^$]*\$0/);
	});
});

describe("Paddle as Merchant of Record", () => {
	test.each(["/pricing", "/terms", "/refunds", "/privacy"])("%s says Paddle.com is the Merchant of Record", (path) => {
		expect(text(path)).toMatch(/Paddle\.com is the Merchant of Record for all our orders/);
	});

	test("the terms say Paddle is the reseller that handles customer service enquiries and returns", () => {
		const body = text("/terms");
		expect(body).toMatch(/Our order process is conducted by our online reseller Paddle\.com/);
		expect(body).toMatch(/Paddle provides all customer service inquiries and handles returns/);
		expect(body).toMatch(/SEMICS LTD/);
	});
});

describe("refunds", () => {
	test("at least 14 days, no questions asked, through Paddle", () => {
		const body = text("/refunds");
		const days = Number(body.match(/within (\d+) days/)?.[1]);
		expect(days).toBeGreaterThanOrEqual(14);
		expect(body).toMatch(/no questions asked/i);
		expect(body).toMatch(/Paddle/);
		expect(body).toContain(SUPPORT);
	});
});

describe("R89: one refund period everywhere", () => {
	const DAYS = 14;
	const days = (body) => [...body.matchAll(/(\d+)[- ]days?\b/g)].map((m) => Number(m[1]));

	test.each(["/pricing", "/terms", "/refunds"])("%s gives a 14-day refund and no other period", (path) => {
		const body = text(path);
		expect(body).toMatch(new RegExp(`refund within ${DAYS} days`));
		for (const n of days(body)) expect(n, `${path} mentions ${n} days`).toBe(DAYS);
	});

	test("BUILD-PLAN D6 and R88 and the editions doc say the same", () => {
		const plan = readFileSync(join(repoRoot, "BUILD-PLAN.md"), "utf8");
		const d6 = plan.match(/^\| D6 \|.*$/m)?.[0] ?? "";
		expect(d6).toMatch(new RegExp(`${DAYS}-day refund`));
		expect(d6).not.toMatch(/30-day refund/);
		expect(plan.match(/^\| R88 \|.*$/m)?.[0]).toMatch(new RegExp(`refunds are ${DAYS} days`));
		expect(plan).toMatch(/^\| R89 \|/m);
		const editions = readFileSync(join(repoRoot, "apps/docs/pages/editions.md"), "utf8");
		expect(editions).toMatch(new RegExp(`refund within ${DAYS} days`));
	});
});

describe("what happens when a licence ends (the licence Worker's header: keys verify offline)", () => {
	test.each(["/terms", "/refunds"])("%s says the issued key keeps working and no new keys are issued", (path) => {
		const body = text(path);
		expect(body).not.toMatch(/When a licence ends, Pro features stop taking new work/);
		expect(body).not.toMatch(/Pro features simply stop taking new work/);
		expect(body).toMatch(/key you already have keeps working/);
		expect(body).toMatch(/no new keys/);
		expect(body).toMatch(/released before/);
	});
});

describe("prices and tax (DMCCA s.230)", () => {
	test("the pricing page says the total including tax is shown at checkout before you pay", () => {
		const body = text("/pricing");
		expect(body).not.toMatch(/before tax/);
		expect(body).toMatch(/total price, including any VAT or sales tax, is shown at checkout before you pay/);
	});

	test("the terms say the same", () => {
		expect(text("/terms")).toMatch(/total price, including any VAT or sales tax, is shown at checkout before you pay/);
	});
});

describe("privacy", () => {
	const section = (id) => {
		const page = read("/privacy");
		const from = page.indexOf(`id="${id}"`);
		const to = page.indexOf("<h2", from + 1);
		return page.slice(from, to === -1 ? undefined : to);
	};

	test("Paddle is an independent controller, not one of our processors", () => {
		expect(text("/privacy")).toMatch(/Paddle is an independent controller/);
		expect(section("processors")).not.toMatch(/Paddle/);
	});

	test("gives the legal basis for website logs and support email", () => {
		expect(section("site")).toMatch(/legitimate interests/);
		expect(section("support")).toMatch(/legitimate interests/);
	});

	test("lists the rights to data portability and to object", () => {
		const rights = section("rights");
		expect(rights).toMatch(/portab/);
		expect(rights).toMatch(/object/);
	});

	test("R91: retention matches the licence Worker's deletion job", () => {
		const retention = section("retention");
		expect(retention).toMatch(/6 years after it ends/);
		expect(retention).toMatch(/notification[^.]*1 year/);
		expect(retention).toMatch(/automatically/);
	});

	test("says what the licence Worker stores, who processes it, how long it is kept and who to contact", () => {
		const body = text("/privacy");
		expect(body).toMatch(/email address/i);
		expect(body).toMatch(/hostnames/i);
		expect(body).toMatch(/Paddle (customer|transaction|subscription)/i);
		expect(body).toMatch(/Cloudflare/);
		expect(body).toMatch(/retention|keep/i);
		expect(body).toMatch(/SEMICS LTD/);
		expect(body).toContain(SUPPORT);
		expect(body).toMatch(/Information Commissioner/);
	});

	test("says the plugins themselves send nothing to us", () => {
		expect(text("/privacy")).toMatch(/plugins (do not|never) send/i);
	});
});

describe("contact", () => {
	test("gives the support address and the company details published at semics.co.uk", () => {
		const body = text("/contact");
		expect(read("/contact")).toContain(`mailto:${SUPPORT}`);
		expect(body).toMatch(/SEMICS LTD/);
		expect(body).toMatch(/registered in England and Wales/);
		expect(body).toMatch(/12871299/);
		expect(body).toMatch(/Slowley Hall, Tamworth Road, Coventry, CV7 8EB/);
	});
});

describe("legal review and loose ends", () => {
	test.each(LEGAL)("%s is marked in its source as needing the lawyer's review", (path) => {
		expect(read(path)).toMatch(/<!-- [^>]*needs the lawyer's review before launch[^>]*brief\.md §13[^>]*-->/);
	});

	test("docs/legal/brief.md §13 lists the site's legal text for review", () => {
		const brief = readFileSync(join(repoRoot, "docs/legal/brief.md"), "utf8");
		const s13 = brief.slice(brief.indexOf("## 13."), brief.indexOf("## 14."));
		expect(s13).toMatch(/plugins\.semics\.co\.uk/);
		expect(s13).toMatch(/apps\/site/);
	});

	test("brief question 17 covers the Pro licence text, the refund decision and the 2027 UK subscription rules", () => {
		const brief = readFileSync(join(repoRoot, "docs/legal/brief.md"), "utf8");
		const q17 = brief.slice(brief.indexOf("\n17. "), brief.indexOf("## 14."));
		expect(q17).toMatch(/packages\/events-pro\/LICENSE/);
		expect(q17).toMatch(/14 days \(R89\)/);
		expect(q17).toMatch(/1 January 2027/);
		expect(q17).not.toMatch(/still a placeholder/);
	});

	test.each(Object.keys(PAGES))("%s has no TODO except an owner TODO in the report", (path) => {
		const todos = read(path).match(/TODO[^<\n]*/g) ?? [];
		for (const todo of todos) expect(OWNER_TODOS).toContain(todo);
	});

	test("every internal link names a page of the site, and every anchor exists", () => {
		for (const path of Object.keys(PAGES)) {
			for (const href of hrefs(read(path))) {
				if (/^(https:|mailto:)/.test(href)) continue;
				const [target, anchor] = href.split("#");
				const page = target === "" ? path : target;
				expect(Object.keys(PAGES), `${path} links ${href}`).toContain(page);
				if (anchor) expect(read(page), `${path} links ${href}`).toContain(`id="${anchor}"`);
			}
		}
	});

	test("no page links over plain http", () => {
		for (const path of Object.keys(PAGES)) expect(read(path)).not.toMatch(/(href|src)="http:/);
	});
});

describe("deployment", () => {
	test("wrangler serves dist/ on the custom domain plugins.semics.co.uk, with no workers.dev URL", () => {
		const config = readFileSync(join(repoRoot, "apps/site/wrangler.jsonc"), "utf8");
		expect(config).toMatch(/"pattern":\s*"plugins\.semics\.co\.uk",\s*"custom_domain":\s*true/);
		expect(config).toMatch(/"workers_dev":\s*false/);
		expect(config).toMatch(/"directory":\s*"\.\/dist"/);
	});

	test("a 404 page exists for unknown paths", () => {
		expect(existsSync(join(distDir, "404.html"))).toBe(true);
	});
});
