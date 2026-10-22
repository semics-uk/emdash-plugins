import { describe, expect, it } from "vitest";

import { cancellationEmail, confirmationEmail, escapeHtml } from "../../src/emails/confirmation";

// Confirmation and cancellation emails (EV-US-3, EV-FR-08, EV-FR-09, R32): pure renderers.

const START = Date.parse("2026-11-14T19:00:00.000Z");
const base = {
	to: "ada@example.com",
	buyerName: "Ada Lovelace",
	bookingRef: "ABCDEFGHJK",
	attendees: ["Ada Lovelace", "Grace Hopper"],
	bookingUrl: "https://site.test/booking?ref=ABCDEFGHJK&k=one-time-code_-x",
	calendarUrl: "https://site.test/_emdash/api/plugins/r_abc/public/event/ics?eventId=ev1",
	siteName: "Town Hall",
};
const event = (timeZone: string) => ({
	title: "Winter Concert",
	startsAt: START,
	endsAt: START + 2 * 3_600_000,
	timeZone,
	venue: "Town Hall, Market Street",
});

describe("EV-FR-08 confirmation email", () => {
	it("EV-FR-08 carries booking, ticket and calendar links and no attachment", () => {
		const m = confirmationEmail({ ...base, event: event("Europe/London") });
		for (const body of [m.text, m.html ?? ""]) {
			expect(body).toContain("/booking?ref=ABCDEFGHJK");
			expect(body).toContain("#tickets");
			expect(body).toContain("/public/event/ics?eventId=ev1");
		}
		expect(Object.keys(m).sort()).toEqual(["html", "subject", "text", "to"]);
		expect(m.to).toBe("ada@example.com");
		expect(m.subject).toContain("Winter Concert");
		expect(m.text).toContain("ABCDEFGHJK");
		expect(m.text).toContain("Grace Hopper");
	});

	it("EV-FR-08 shows the start in the event's own zone: London, New York and Tokyo", () => {
		const text = (zone: string) => confirmationEmail({ ...base, event: event(zone) }).text;
		const when = (zone: string) => /^When: (.*)$/m.exec(text(zone))?.[1];
		expect(when("Europe/London")).toBe("Sat 14 Nov 2026, 19:00 UTC (Europe/London)");
		expect(when("America/New_York")).toBe("Sat 14 Nov 2026, 14:00 UTC-5 (America/New_York)");
		expect(when("Asia/Tokyo")).toBe("Sun 15 Nov 2026, 04:00 UTC+9 (Asia/Tokyo)");
		expect(when("Asia/Kolkata")).toBe("Sun 15 Nov 2026, 00:30 UTC+5:30 (Asia/Kolkata)");
		expect(when("Not/AZone")).toBe("Sat 14 Nov 2026, 19:00 UTC (UTC)");
		expect(text("Asia/Tokyo")).toMatchInlineSnapshot(`
			"Hi Ada Lovelace,

			Your booking for Winter Concert is confirmed.

			When: Sun 15 Nov 2026, 04:00 UTC+9 (Asia/Tokyo)
			Where: Town Hall, Market Street
			Reference: ABCDEFGHJK

			Tickets:
			- Ada Lovelace
			- Grace Hopper

			View or cancel your booking: https://site.test/booking?ref=ABCDEFGHJK&k=one-time-code_-x
			Your tickets (check-in passes): https://site.test/booking?ref=ABCDEFGHJK&k=one-time-code_-x#tickets
			Add to calendar: https://site.test/_emdash/api/plugins/r_abc/public/event/ics?eventId=ev1

			The booking link opens your booking once on the device you use it from, so keep this email private.
			Town Hall"
		`);
	});

	it("EV-FR-08 escapes HTML in names and titles but leaves tokens and hyphens alone (R32)", () => {
		const m = confirmationEmail({
			...base,
			attendees: ["<script>alert(1)</script>", "Anne-Marie O'Neil & Co"],
			event: { ...event("Europe/London"), title: "Rock <b>&</b> Roll" },
		});
		expect(m.html).not.toContain("<script>");
		expect(m.html).toContain("&lt;script&gt;");
		expect(m.html).toContain("Anne-Marie O&#39;Neil &amp; Co");
		expect(m.html).toContain("Rock &lt;b&gt;&amp;&lt;/b&gt; Roll");
		expect(m.text).toContain("Anne-Marie O'Neil & Co");
		expect(m.html).toContain('href="https://site.test/booking?ref=ABCDEFGHJK&amp;k=one-time-code_-x"');
		expect(escapeHtml(`"'<>&`)).toBe("&quot;&#39;&lt;&gt;&amp;");
	});
});

describe("EV-FR-09 cancellation email", () => {
	it("EV-FR-09 names the event and the reference and has no booking link", () => {
		const m = cancellationEmail({ ...base, event: event("Europe/London") });
		expect(m.subject).toContain("cancelled");
		expect(m.text).toContain("Winter Concert");
		expect(m.text).toContain("ABCDEFGHJK");
		expect(m.text).toContain("19:00 UTC (Europe/London)");
		expect(m.text).not.toContain("k=");
		expect(m.html).not.toContain("k=");
	});
});
