// The product site's pages (T124). Company facts are the ones SEMICS LTD publishes at https://semics.co.uk
// (footer and JSON-LD); prices are BUILD-PLAN D5 and the Pro licence Worker's plans.ts. The terms, refund
// and privacy text (`review: true`) needs the lawyer's review before launch (docs/legal/brief.md §13).

export const SITE = {
	origin: "https://plugins.semics.co.uk",
	support: "support@semics.co.uk",
	repo: "https://github.com/semics-uk/emdash-plugins",
	docs: "https://github.com/semics-uk/emdash-plugins/tree/main/apps/docs/pages",
	company: {
		name: "SEMICS LTD",
		number: "12871299",
		office: "Slowley Hall, Tamworth Road, Coventry, CV7 8EB",
	},
};

const { support, repo, docs, company } = SITE;
const mail = `<a href="mailto:${support}">${support}</a>`;
const docsPage = (file) => `${docs}/${file}`;

/** Paddle's reseller wording, used wherever a sale is described. */
const MOR =
	"Our order process is conducted by our online reseller Paddle.com. Paddle.com is the Merchant of Record for all our orders. Paddle provides all customer service inquiries and handles returns.";
const MOR_SHORT = "Paddle.com is the Merchant of Record for all our orders.";

const PLANS = [
	{
		name: "Events Pro",
		usd: 79,
		sites: "1 site",
		what: "Everything in Events Free, plus paid tickets, promo codes, custom questions, QR passes and phone check-in, reminders, reports and required waivers.",
	},
	{
		name: "E-sign Pro",
		usd: 79,
		sites: "1 site",
		what: "Everything in E-sign Free, plus several signers, an email one-time code, reminders, uploaded PDF templates, signing forms and bulk send.",
	},
	{ name: "Suite Pro", usd: 129, sites: "1 site", what: "Events Pro and E-sign Pro together, for one site." },
	{
		name: "Agency",
		usd: 349,
		sites: "up to 10 sites",
		what: "Events Pro and E-sign Pro together, for up to 10 sites.",
	},
];

const home = {
	path: "/",
	file: "index.html",
	title: "semics plugins for EmDash: events, bookings and e-signatures",
	description:
		"Events bookings and E-sign plugins for the EmDash CMS. Free and open source, with Pro editions for paid tickets and multi-party signing.",
	body: `
<h1>Events bookings and e-signatures for EmDash</h1>
<p class="lead">Two plugins for the <a href="https://github.com/emdash-cms/emdash">EmDash</a> CMS, made by ${company.name}. Both are free and open source. Pro editions add what organisations pay for.</p>
<div class="cards">
<section class="card"><h2>Events</h2><p>Turn your events into bookable ones: ticket types, capacity, a booking page, confirmation emails with calendar files, a waitlist, recurring events, self-service cancellation and check-in.</p><p><a href="${docsPage("events.md")}">Events guide</a></p></section>
<section class="card"><h2>E-sign</h2><p>Send agreements from Markdown templates and collect a typed or drawn signature. Each signature has consent capture, a hash-chained audit trail and a signed PDF with a certificate anyone can check.</p><p><a href="${docsPage("esign.md")}">E-sign guide</a></p></section>
<section class="card"><h2>Together</h2><p>Install both and a booking can require a waiver: the attendee signs before the ticket is confirmed. Waivers are an Events Pro feature.</p><p><a href="${docsPage("waivers.md")}">Waivers guide</a></p></section>
</div>
<h2>Free and Pro</h2>
<p><strong>Free</strong> is MIT licensed, on the EmDash plugin registry and npm, and complete for the common case: a free or RSVP event, and a one-signer agreement. <strong>Pro</strong> is the same plugin built with more features, unlocked by a licence key for your site.</p>
<table>
<thead><tr><th scope="col">What you get</th><th scope="col">Free</th><th scope="col">Pro</th></tr></thead>
<tbody>
<tr><td>Free tickets and RSVP, booking page, emails, calendar files, waitlist, recurring events, check-in</td><td>Yes</td><td>Yes</td></tr>
<tr><td>Paid tickets through your own Stripe account, promo codes, custom questions, QR passes, reminders, reports</td><td></td><td>Yes</td></tr>
<tr><td>One-signer agreements, consent capture, audit trail, signed PDF, verify page</td><td>Yes</td><td>Yes</td></tr>
<tr><td>Several signers, email one-time code, reminders, uploaded PDFs, signing forms, bulk send</td><td></td><td>Yes</td></tr>
<tr><td>Security, privacy, retention and deletion, CSV export, the public API</td><td>Yes</td><td>Yes</td></tr>
</tbody>
</table>
<p>Security, privacy, legal evidence and getting your data out are never Pro. Moving between Free and Pro keeps all your data. See the full comparison in <a href="${docsPage("editions.md")}">Free and Pro</a>.</p>
<p><a href="/pricing">See prices</a> or <a href="${docsPage("install.md")}">install the free plugins</a>. The source is on <a href="${repo}">GitHub</a>.</p>
`,
};

const pricing = {
	path: "/pricing",
	file: "pricing.html",
	title: "Pricing: semics plugins for EmDash",
	description: "Events Pro $79, E-sign Pro $79, Suite Pro $129 and Agency $349 a year. Free is free.",
	body: `
<h1>Pricing</h1>
<p class="lead">Pro licences are per site, per year. Each includes a year of updates and email support.</p>
<div class="cards">
<section class="card"><h2>Free</h2><p class="price">$0</p><p>Events and E-sign, MIT licensed, for any number of sites.</p><p><a href="${docsPage("install.md")}">Install</a></p></section>
${PLANS.map(
	(p) =>
		`<section class="card"><h2>${p.name}</h2><p class="price">$${p.usd} a year <small>${p.sites}</small></p><p>${p.what}</p></section>`,
).join("\n")}
</div>
<p class="note"><strong>Buy links are coming.</strong> Online checkout opens soon. Until then, email ${mail} to buy a licence or ask a question.</p>
<h2>How it works</h2>
<ul>
<li>Prices are in US dollars, before tax. At checkout Paddle adds VAT or sales tax where it applies, and may show the price in your currency.</li>
<li>${MOR} Your receipt and invoice come from Paddle.</li>
<li>After payment you receive a licence key by email, tied to your site's hostnames. Paste it into the plugin's settings. The plugin checks it offline; it never calls home.</li>
<li>A licence renews each year until you cancel. You can cancel at any time and keep Pro until the end of the year you paid for.</li>
<li>Versions released while your licence was current keep working after it ends. See <a href="${docsPage("editions.md")}">how Pro works</a>.</li>
<li>Changed your mind? You can have a full refund within 14 days, no questions asked. See <a href="/refunds">Refunds</a>.</li>
</ul>
`,
};

const terms = {
	path: "/terms",
	file: "terms.html",
	review: true,
	title: "Terms of sale: semics plugins for EmDash",
	description: "The terms on which SEMICS LTD sells Pro licences for its EmDash plugins, through Paddle.com.",
	body: `
<h1>Terms of sale</h1>
<p>These terms apply when you buy a Pro licence for the semics Events or E-sign plugins for EmDash. Please read them before you buy.</p>
<h2 id="who">Who we are</h2>
<p>We are ${company.name}, a company registered in England and Wales, company number ${company.number}. Our registered office is ${company.office}. You can reach us at ${mail}.</p>
<h2 id="paddle">How you buy: Paddle</h2>
<p>${MOR}</p>
<p>This means you buy the licence from Paddle, which takes your payment, charges any sales tax and issues your invoice. Paddle's own <a href="https://www.paddle.com/legal/checkout-buyer-terms">buyer terms</a> apply to the purchase. These terms cover the licence and the software we supply.</p>
<h2 id="licence">What you get</h2>
<ul>
<li>A licence key for the plan you chose: one site for Events Pro, E-sign Pro or Suite Pro, or up to 10 sites for Agency. A site is identified by its hostnames.</li>
<li>The right to install and use the Pro plugin on the licensed sites, under the licence that comes with the Pro package.</li>
<li>Updates and email support for one year from the date you pay.</li>
</ul>
<p>Prices are on the <a href="/pricing">pricing page</a>. The price you pay is the one shown at checkout.</p>
<h2 id="renewal">Renewal and cancelling</h2>
<p>A licence renews each year and Paddle charges you for the next year unless you cancel. You can cancel at any time from the link in your Paddle receipt or by emailing ${mail}. Cancelling stops the next renewal; you keep Pro features and updates until the end of the year you paid for.</p>
<p>When a licence ends, Pro features stop taking new work on your site, but nothing is deleted. Work already in progress carries on, and versions released while your licence was current keep working.</p>
<h2 id="refunds">Refunds</h2>
<p>You can have a full refund within 14 days of a purchase or renewal, for any reason. See our <a href="/refunds">refund policy</a>. If you are a consumer, this does not affect your legal rights.</p>
<h2 id="use">Your use of the plugins</h2>
<ul>
<li>You must not share your licence key with sites it does not cover, or try to get around the licence check.</li>
<li>You are responsible for your site, the data it collects and how you use it, including the documents you ask people to sign and the payments you take through your own Stripe account.</li>
<li>The plugins run on your site. They do not send your visitors' or signers' data to us.</li>
</ul>
<h2 id="liability">Our responsibility</h2>
<p>We will supply the software with reasonable care and skill. If a Pro feature does not work as described, tell us and we will try to fix it; if we cannot, you may ask for a refund of the current year's fee.</p>
<p>We are not responsible for losses that were not foreseeable, for business losses such as lost profits, or for the content of documents signed with E-sign. Our total liability to you for any year of a licence is limited to the fee you paid for that year. Nothing in these terms limits liability that cannot be limited by law, such as for death or personal injury caused by negligence, or for fraud.</p>
<h2 id="free">The free plugins</h2>
<p>Events Free and E-sign Free are open source under the MIT licence, which applies to them instead of these terms.</p>
<h2 id="changes">Changes and law</h2>
<p>We may update these terms. The version in force when you buy or renew applies to that year. These terms are governed by the law of England and Wales. If you are a consumer living elsewhere in the UK or the EU, you also keep the protection of the law where you live.</p>
`,
};

const refunds = {
	path: "/refunds",
	file: "refunds.html",
	review: true,
	title: "Refund policy: semics plugins for EmDash",
	description: "A full refund within 14 days of any purchase or renewal, no questions asked, through Paddle.",
	body: `
<h1>Refund policy</h1>
<p class="lead">If you are not happy, you can have a full refund within 14 days of a purchase or renewal, no questions asked.</p>
<h2 id="how">How to ask</h2>
<ul>
<li>Email ${mail} with your order number or the email address you bought with, or</li>
<li>Ask Paddle directly at <a href="https://paddle.net">paddle.net</a>, using the details on your receipt.</li>
</ul>
<p>${MOR} Paddle sends the refund to the card or account you paid with. Banks usually take 5 to 10 working days to show it.</p>
<h2 id="after">After a refund</h2>
<p>The licence ends when the refund is made: we issue no new keys for it, and you should remove the licence key from your site. Your data stays where it is; Pro features simply stop taking new work, as they do when any licence ends.</p>
<h2 id="later">After 14 days</h2>
<p>After 14 days we do not usually refund, but you can cancel at any time so that your licence does not renew. If a Pro feature does not work as described and we cannot fix it, we will refund the current year's fee. If you are a consumer, this policy does not affect your legal rights.</p>
`,
};

const privacy = {
	path: "/privacy",
	file: "privacy.html",
	review: true,
	title: "Privacy policy: semics plugins for EmDash",
	description:
		"What SEMICS LTD stores when you buy a Pro licence, who processes it, how long we keep it and your rights.",
	body: `
<h1>Privacy policy</h1>
<p>This policy explains what personal data ${company.name} holds when you visit this site or buy a Pro licence, and what we do with it. We are the controller of that data. Contact us at ${mail}, or write to ${company.name}, ${company.office}.</p>
<h2 id="plugins">The plugins themselves</h2>
<p>The Events and E-sign plugins run on your own EmDash site. The plugins do not send your visitors', attendees' or signers' data to us, and the licence check works offline. For that data, the site owner is the controller; see <a href="${docsPage("privacy.md")}">Data and retention</a> in the docs.</p>
<h2 id="site">This website</h2>
<p>This site sets no cookies and runs no analytics or tracking scripts. It is served by Cloudflare, which processes your IP address and request details to deliver the pages and protect the site from abuse.</p>
<h2 id="buying">When you buy a licence</h2>
<p>${MOR} Paddle collects your payment and billing details and is responsible for them under its own <a href="https://www.paddle.com/legal/privacy">privacy policy</a>. We never see your card details.</p>
<p>When Paddle tells us about a sale, our licence service stores:</p>
<ul>
<li>your email address, which we look up from Paddle so we can send your licence key;</li>
<li>the hostnames of the sites you licence;</li>
<li>Paddle customer, transaction and subscription ids, and the plan you bought;</li>
<li>the licence key, its dates and its status (active, cancelled or refunded);</li>
<li>a record of each notification Paddle sends us (its id, type and when it arrived), so that no sale is handled twice.</li>
</ul>
<p>We use this to issue and re-issue licence keys, handle renewals, cancellations and refunds, and answer support requests. Our legal basis is that we need it to perform our contract with you, and to keep records the law requires.</p>
<p>If you email us, we keep your message and address to answer you.</p>
<h2 id="processors">Who processes it for us</h2>
<ul>
<li><strong>Cloudflare</strong> runs our licence service, stores its database (located in Western Europe) and sends our licence emails.</li>
<li><strong>Paddle</strong>, as Merchant of Record, holds the payment and order data.</li>
</ul>
<p>Some of these providers may process data outside the UK. Where they do, they use safeguards recognised under UK law, such as the UK International Data Transfer Addendum.</p>
<h2 id="retention">How long we keep it</h2>
<p>We keep a licence record while the licence is active and for 6 years after it ends, so we can support refunds and disputes and meet UK tax and accounting record-keeping rules. We then delete it. Support emails are deleted 2 years after the last message.</p>
<h2 id="rights">Your rights</h2>
<p>You can ask for a copy of your data, ask us to correct it, or ask us to delete it or stop using it where the law allows. Email ${mail}. If you are unhappy with how we handle your data, you can complain to the Information Commissioner's Office at <a href="https://ico.org.uk">ico.org.uk</a>.</p>
<h2 id="changes">Changes</h2>
<p>We will update this page if what we collect or how we use it changes.</p>
`,
};

const contact = {
	path: "/contact",
	file: "contact.html",
	title: "Contact: semics plugins for EmDash",
	description: "Support, sales and company details for the semics plugins for EmDash.",
	body: `
<h1>Contact</h1>
<p>For support, buying a licence, refunds or privacy questions, email ${mail}.</p>
<p>Bugs and feature requests for the free plugins are welcome on <a href="${repo}/issues">GitHub</a>. Please report security issues privately as described in our <a href="${repo}/blob/main/SECURITY.md">security policy</a>.</p>
<h2 id="company">Company details</h2>
<p>${company.name} is a company registered in England and Wales, company number ${company.number}.<br>Registered office: ${company.office}.<br>Website: <a href="https://semics.co.uk">semics.co.uk</a>.</p>
<p>${MOR_SHORT} For questions about a payment, you can also contact Paddle at <a href="https://paddle.net">paddle.net</a>.</p>
`,
};

export const PAGES = [home, pricing, terms, refunds, privacy, contact];

export const NOT_FOUND = {
	path: "/404",
	file: "404.html",
	title: "Page not found: semics plugins for EmDash",
	description: "This page does not exist.",
	body: `<h1>Page not found</h1><p>That page does not exist. Try the <a href="/">home page</a> or <a href="/pricing">pricing</a>.</p>`,
};
