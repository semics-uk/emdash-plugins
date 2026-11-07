import { describe, expect, it } from "vitest";

import {
	approvalEmail,
	cancellationEmail,
	confirmationEmail,
	escapeHtml,
	formatWhen,
	offerEmail,
} from "../../src/emails/confirmation";
import type { BookingDoc } from "../../src/storage/schema";

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
		expect(when("Europe/London")).toBe("Sat 14 Nov 2026, 19:00 (Europe/London)");
		expect(when("America/New_York")).toBe("Sat 14 Nov 2026, 14:00 (America/New_York)");
		expect(when("Asia/Tokyo")).toBe("Sun 15 Nov 2026, 04:00 (Asia/Tokyo)");
		expect(when("Asia/Kolkata")).toBe("Sun 15 Nov 2026, 00:30 (Asia/Kolkata)");
		expect(when("Not/AZone")).toBe("Sat 14 Nov 2026, 19:00 (UTC)");
		expect(text("Asia/Tokyo")).toMatchInlineSnapshot(`
			"Hi Ada Lovelace,

			Your booking for Winter Concert is confirmed.

			When: Sun 15 Nov 2026, 04:00 (Asia/Tokyo)
			Where: Town Hall, Market Street
			Reference: ABCDEFGHJK

			Tickets:
			- Ada Lovelace
			- Grace Hopper

			View or cancel your booking: https://site.test/booking?ref=ABCDEFGHJK&k=one-time-code_-x
			Your check-in passes: https://site.test/booking?ref=ABCDEFGHJK&k=one-time-code_-x#tickets
			Add to calendar: https://site.test/_emdash/api/plugins/r_abc/public/event/ics?eventId=ev1

			Keep this email private: its link opens your booking once.
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
		expect(m.text).toContain("19:00 (Europe/London)");
		expect(m.text).not.toContain("k=");
		expect(m.html).not.toContain("k=");
	});
});

describe("email times are plain local time in the event's zone", () => {
	it("EV-FR-08 London across the clock change: 19:00 local both in BST and in GMT, never a UTC label", () => {
		const at = (iso: string) => formatWhen({ startsAt: Date.parse(iso), timeZone: "Europe/London" });
		expect(at("2026-07-14T18:00:00.000Z")).toBe("Tue 14 Jul 2026, 19:00 (Europe/London)");
		expect(at("2026-11-14T19:00:00.000Z")).toBe("Sat 14 Nov 2026, 19:00 (Europe/London)");
		expect(at("2026-11-11T10:30:00.000Z")).toBe("Wed 11 Nov 2026, 10:30 (Europe/London)");
		expect(at("2026-10-25T00:30:00.000Z")).toBe("Sun 25 Oct 2026, 01:30 (Europe/London)");
		expect(at("2026-10-25T01:30:00.000Z")).toBe("Sun 25 Oct 2026, 01:30 (Europe/London)");
	});

	it("EV-FR-16 a waitlist offer's deadline is in the event's zone too", () => {
		const m = offerEmail({ ...base, event: event("Europe/London"), seats: 1, expiresAt: "2026-07-02T11:00:00.000Z" });
		expect(m.text).toContain("held for you until Thu 2 Jul 2026, 12:00 (Europe/London).");
		expect(m.text).not.toContain("UTC");
		const odd = offerEmail({ ...base, event: event("Europe/London"), seats: 1, expiresAt: "soon" });
		expect(odd.text).toContain("held for you until soon.");
	});
});

describe("approval notices (T131)", () => {
	const booking = (over: Partial<BookingDoc>) =>
		({
			ref: "ABCDEFGHJK",
			status: "awaiting_approval",
			holdExpiresAt: "2026-07-02T11:00:00.000Z",
			buyer: { name: "Ada Lovelace", email: "ada@example.com" },
			email: "ada@example.com",
			lines: [{ ticketTypeId: "tt", qty: 2, unitPriceMinor: 0 }],
			...over,
		}) as BookingDoc;
	const send = (kind: string, b: BookingDoc) =>
		approvalEmail({ kind, to: "desk@example.com" }, b, event("Europe/London"), "Town Hall", "https://site.test/admin");

	it("T131 a booking still waiting: 'Booking request', a decision is needed, by the deadline in the event's zone", () => {
		const m = send("approval_admin", booking({}));
		expect(m?.subject).toBe("Booking request: Winter Concert");
		expect(m?.text).toContain("Decision needed: approve or decline by Thu 2 Jul 2026, 12:00 (Europe/London)");
		expect(m?.text).toContain("or it expires");
		expect(m?.html).toContain("Decision needed");
		expect(m?.text).toContain("Open Bookings: https://site.test/admin");
	});

	it("T131 a deadline that is no date cannot lose the mail: shown as stored", () => {
		expect(send("approval_admin", booking({ holdExpiresAt: "soon" }))?.text).toContain(
			"decline by soon, or it expires",
		);
	});

	it("T131 approved before the mail went out (CZR3RFJKQ5): 'New booking', nothing asked of the organiser", () => {
		const m = send("approval_admin", booking({ status: "confirmed" }));
		expect(m?.subject).toBe("New booking: Winter Concert");
		expect(m?.text).not.toContain("Decision");
	});

	it("T131 ended before the mail went out: the organiser is not told of a 'new booking'", () => {
		for (const status of ["declined", "expired", "cancelled", "refunded", "refunded_unavailable"] as const) {
			expect(send("approval_admin", booking({ status }))).toBeNull();
		}
	});

	it("T132 approved with a refused card, so waiting for payment: a second admin's queued notice still goes", () => {
		expect(send("approval_admin", booking({ status: "awaiting_payment" }))?.subject).toBe(
			"New booking: Winter Concert",
		);
	});

	it("T131 a decline gives the reason, and says the card was not charged only when the booking says so", () => {
		const b = { status: "declined", declineReason: "Fully booked" } as const;
		const uncharged = send("approval_declined", booking({ ...b, notCharged: true }));
		expect(uncharged?.text).toContain("was declined: Fully booked");
		expect(uncharged?.text).toContain("Your card was not charged.");
		expect(uncharged?.html).toContain("Your card was not charged.");
		for (const over of [{}, { notCharged: false }]) {
			expect(send("approval_declined", booking({ ...b, ...over }))?.text).not.toContain("not charged");
		}
	});
});
