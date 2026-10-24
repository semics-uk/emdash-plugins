// T103: the docs site builds with no broken link, and says what the earlier tasks asked it to say.
// Each "says" test names the task or decision (BUILD-PLAN §12) that filed it.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { buildSite, PAGES, repoRoot } from "../build.mjs";
import { pageText } from "./helpers.mjs";

const PAGE = (name) => `apps/docs/pages/${name}.md`;

/** Fails with the statements a page is missing. */
function says(src, statements) {
	assert.ok(existsSync(join(repoRoot, src)), `${src} is missing`);
	const text = pageText(src);
	const missing = Object.entries(statements)
		.filter(([, pattern]) => !pattern.test(text))
		.map(([what]) => what);
	assert.deepEqual(missing, [], `${src} does not say: ${missing.join("; ")}`);
}

test("the site builds every page with no broken link, anchor or image", () => {
	const { pages, problems } = buildSite({ write: false });
	assert.deepEqual(problems, []);
	assert.equal(pages.length, PAGES.length);
	for (const page of pages) assert.match(page.html, /<main id="main">/);
});

test("T057 F9: the operator guide says when to trust client-IP headers, and how Astro.url gets the public host", () => {
	says(PAGE("configure"), {
		"trustedProxyHeaders names the header": /trustedProxyHeaders/,
		"only when a proxy in front overwrites it": /only (when|if) a (reverse )?proxy in front (of the site )?overwrites/i,
		"the UI forwards client-IP headers as sent":
			/forwards? (them|the visitor's client-IP headers|client-IP headers) as (they were )?sent/i,
		"the per-IP reserve limit depends on them": /per-IP (reserve |booking )?limit/i,
		"security.allowedDomains gives Astro.url the public host": /security\.allowedDomains[^.]*Astro\.url/,
		"EmDash turns checkOrigin off": /checkOrigin/,
		"the forms check Origin themselves": /check (the )?Origin themselves|check(s)? the request's origin themselves/i,
	});
});

test("T043: the editor panel is scoped to the events collection, and EmDash cannot scope it at run time", () => {
	says(PAGE("events"), {
		"panel scoped to the events collection in the manifest": /Tickets & booking[^.]*`events` collection/,
		"other collections see it only there": /another collection/i,
		"the Event editor page works for any mapping": /Event editor[^.]*(any|every) (collection|mapping)/i,
		"EmDash cannot scope a panel dynamically":
			/cannot (scope|choose|change) (a|the) panel'?s? collections? (at run time|dynamically)/i,
	});
});

test("T074: site-owner Stripe setup for Events Pro", () => {
	says(PAGE("payments"), {
		"secret key scopes": /restricted key[^.]*Checkout Sessions[^.]*Refunds/i,
		"webhook URL with the plugin id": /\/_emdash\/api\/plugins\/<plugin id>\/webhooks\/stripe/,
		"checkout.session.completed": /checkout\.session\.completed/,
		"checkout.session.expired": /checkout\.session\.expired/,
		"checkout.session.async_payment_succeeded": /checkout\.session\.async_payment_succeeded/,
		"checkout.session.async_payment_failed": /checkout\.session\.async_payment_failed/,
		stripeWebhookSecret: /stripeWebhookSecret/,
	});
});

test("R49: an amount mismatch is refunded with Stripe's receipt only and a warning in the logs", () => {
	says(PAGE("payments"), {
		"refunded automatically": /refund(s|ed)? (it )?(in full )?automatically/i,
		"no plugin email": /no (plugin )?email|does not email|is not emailed/i,
		"only Stripe's refund receipt": /Stripe's (refund )?receipt/i,
		"a warning in the logs": /warning[^.]*log/i,
		"where to look": /stripe payment amount differs from the booking; refunding/,
		"the refund's metadata in the Stripe dashboard": /amount_mismatch/,
	});
});

test("T097 R45: the retention guide carries over the README, including what the signed record keeps", () => {
	says(PAGE("privacy"), {
		"Keep personal data (months)": /Keep personal data \(months\)/,
		"Keep signed records (years)": /Keep signed records \(years\)/,
		"name and IP kept until the signed-records period ends":
			/name and IP address[^.]*until the signed-records period ends/i,
		"the participant (minor) name on the certificate": /participant'?s? name[^.]*minor|minor'?s? name/i,
		"Details entered by the signer stays in the signed PDF": /Details entered by the signer/,
		"deletion on request": /Delete personal data/,
		"/verify after the signed-records period": /\/verify[^.]*no longer/i,
	});
});

test("legal brief §12: the E-sign README matches the code", () => {
	const readme = pageText("packages/esign/README.md");
	assert.match(readme, /participant/i, "the README names the participant (minor) on the certificate");
	assert.match(readme, /Details entered by the signer/, "the README says entered values stay in the signed PDF");
	const plan = readFileSync(join(repoRoot, "BUILD-PLAN.md"), "utf8");
	const r45 = /^\| R45 \|.*$/m.exec(plan)?.[0] ?? "";
	assert.match(r45, /participant/i, "R45 names the participant on the certificate");
	assert.match(r45, /Details entered by the signer/, "R45 says entered values stay in the signed PDF");
});

test("R52: custom attendee answers are collected once per booking and shown only in the CSV", () => {
	says(PAGE("events"), {
		"once per booking": /once per booking/i,
		"in the attendee CSV": /attendee CSV|CSV export/i,
		"not on the booking page, in emails or on waitlist offers":
			/not (shown )?on the booking page, in (the )?emails?,? or (on )?waitlist[- ]offer bookings/i,
	});
});

test("R58: the docs link the translation guide and say what stays English", () => {
	says(PAGE("translations"), {
		"links docs/i18n.md": /\(\.\.\/\.\.\/\.\.\/docs\/i18n\.md\)/,
		"emails, calendar files and the admin stay English":
			/emails, calendar files and the (Block Kit )?admin[^.]*English/i,
		"the suite's waiver and templates pages stay English":
			/\/_events\/waiver[^.]*\/_events\/templates[^.]*English|English[^.]*\/_events\/waiver[^.]*\/_events\/templates/i,
	});
});

test("features and their limits: the outbox drain, PDFs, opt-out, MCP, check-in, accessibility", () => {
	says(PAGE("events"), {
		"two messages a minute": /two (emails|messages) a minute/i,
		"opt-out page (R57)": /\/_events\/opt-out/,
		"check-in screen (R54)": /\/_events\/check-in/,
		"Events MCP tools (R59)":
			/listEvents[^.]*getAvailability[^.]*findBooking[^.]*cancelBooking[^.]*listAttendees[^.]*checkInAttendee[^.]*refundBooking/s,
	});
	says(PAGE("esign"), {
		"uploaded PDF limit (R53)": /3 MiB/,
		"uploaded PDF page limit (R53)": /500 pages/,
		"E-sign MCP tools (R55)":
			/listTemplates[^.]*sendForSignature[^.]*getEnvelopeStatus[^.]*remindSigners[^.]*voidEnvelope/s,
	});
	says(PAGE("accessibility"), {
		"WCAG 2.2 AA (R56)": /WCAG 2\.2/,
		"320 px reflow": /320/,
		"third parties out of scope": /Turnstile/,
	});
	says(PAGE("editions"), { "Free and Pro table": /\| *Free *\| *Pro *\|/ });
});

test("T100 follow-ups: page caching (R62), Pro export expiry (R63), counter sweep (R61), MCP call counts (R60)", () => {
	says(PAGE("configure"), {
		"no shared page cache for booking pages": /an event page with a booking form, in a cache shared/i,
		"a resubmit re-issues a held booking's token": /fresh access token while it is still on hold/i,
	});
	says(PAGE("privacy"), {
		"Pro exports expire 24 hours after their last step": /expires 24 hours after its last step/i,
		"rate-limit counters are swept by retention": /rate-limit counters[^.]*deleted by the same retention pass/i,
	});
	says(PAGE("events"), {
		"paid cancel and refund at 10 and 9 calls": /paid booking \(10 calls\) and `refundBooking` \(9\)/,
	});
});

test("SX-FR-06 the docs carry the pairing guide: a client, its pairing string shown once, pasted into Events", () => {
	says(PAGE("esign"), {
		"a client with its allowed return URLs": /Create client[^.]*return URLs/,
		"the pairing string is shown once": /pairing string[^.]*\. It is shown only in that one answer/,
		"revoking stops a client": /Revoke\*{0,2} stops a client at once/,
	});
	says(PAGE("waivers"), {
		"the return URL is the booking page": /return URL is[^.]*\/booking/,
		"paste it into the Events setting": /paste it into\W*E-sign pairing string/,
	});
});

test("T121 R85: Pro installs from public npm and the licence key unlocks it; no access token, no paid npm plan", () => {
	const install = {
		"Pro comes from public npm packages": /public npm package/i,
		"the npm install line": /npm install @semics-tech\/emdash-events-pro/,
		"nothing Pro works without a key": /nothing Pro (works|runs) without (a valid|the) (licence )?key/i,
	};
	says(PAGE("install"), install);
	says(PAGE("editions"), { "Pro comes from public npm packages": install["Pro comes from public npm packages"] });
	for (const page of ["install", "editions"]) {
		const text = pageText(PAGE(page));
		assert.doesNotMatch(text, /private npm package/i, page);
		assert.doesNotMatch(text, /installed with an access token/i, page);
	}
	const read = (p) => readFileSync(join(repoRoot, p), "utf8");
	const plan = read("BUILD-PLAN.md");
	assert.match(plan, /^\| R85 \|/m, "R85 is in the decision log");
	assert.match(plan.match(/^\| R67 \|.*$/m)?.[0] ?? "", /R85/, "R67 points at R85");
	assert.doesNotMatch(plan, /private npm packages `@semics-tech\/emdash-events-pro`/);
	const review = read("tasks/reviews/release-1.0.md");
	assert.doesNotMatch(review, /granular access token/i, "no per-sale npm token step");
	assert.doesNotMatch(review, /paid Teams plan/i, "no paid npm plan step");
	assert.doesNotMatch(review, /\*\*restricted\*\*/);
	assert.match(review, /installs? (it )?from npm[^.]*key/i, "the each-sale step: install from npm, paste the key");
	assert.doesNotMatch(read("CONTRIBUTING.md"), /paid npm plan/i);
});
