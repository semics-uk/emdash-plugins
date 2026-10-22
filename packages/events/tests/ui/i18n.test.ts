import { describe, expect, it } from "vitest";

import { cardView, type PublicEventSummary } from "../../src/astro/lib/list";
import { paymentView } from "../../src/astro/lib/payment";
import { promoNote } from "../../src/astro/lib/promo";
import { questionControls } from "../../src/astro/lib/questions";
import { waitlistMessage } from "../../src/astro/lib/waitlist";
import { type BookingView, errorMessage, fieldMessage, formatMoney, statusLabel } from "../../src/astro/lib/widget";
import { checkInView } from "../../src/client/checkin";
import { ar } from "../../src/i18n/ar";
import { en } from "../../src/i18n/en";
import { clientMessages, directionOf, LANGUAGES, languageOf, translator } from "../../src/i18n/index";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const ARABIC = /[؀-ۿ]/;

describe("translations (EU-NFR-04, T102)", () => {
	it("EU-NFR-04 every language has every English key, none empty, with the same placeholders", () => {
		for (const [lang, table] of Object.entries(LANGUAGES)) {
			const keys = Object.keys(table).filter((k) => !/\.(zero|two|few|many)$/.test(k));
			expect(keys.sort(), lang).toEqual(Object.keys(en).sort());
			for (const [key, text] of Object.entries(table)) {
				expect(text.trim(), `${lang} ${key}`).not.toBe("");
				const base = key.replace(/\.(zero|one|two|few|many|other)$/, ".other");
				const source = (en as Record<string, string>)[key] ?? (en as Record<string, string>)[base];
				expect(placeholders(text), `${lang} ${key}`).toEqual(placeholders(source));
			}
		}
	});

	it("EU-NFR-04 the Arabic table is Arabic", () => {
		for (const [key, text] of Object.entries(ar)) {
			const words = text.replace(/\{\w+\}/g, "");
			if (/\p{L}/u.test(words)) expect(words, key).toMatch(ARABIC);
		}
	});

	it("EU-NFR-04 a locale picks its language and direction; an unknown one falls back to English", () => {
		expect(languageOf("ar-EG")).toBe("ar");
		expect(languageOf("en-GB")).toBe("en");
		expect(languageOf("fr-FR")).toBe("en");
		expect(languageOf(undefined)).toBe("en");
		expect(directionOf("ar")).toBe("rtl");
		expect(directionOf("en-GB")).toBe("ltr");
		// Hebrew has no table yet, so its pages are English and stay left to right.
		expect(directionOf("he")).toBe("ltr");
	});

	it("EU-NFR-04 fills placeholders and picks plural forms by the language's rules", () => {
		const t = translator("en-GB");
		expect(t.lang).toBe("en");
		expect(t.t("checkin.checkedIn.title", { name: "Ada" })).toBe("Checked in: Ada");
		expect(t.plural("booking.lines", 1, { count: 1 })).not.toBe(t.plural("booking.lines", 2, { count: 2 }));
		const a = translator("ar");
		expect(a.dir).toBe("rtl");
		expect(a.t("widget.heading")).toBe(ar["widget.heading"]);
	});

	it("EU-NFR-04 client scripts get only their own messages", () => {
		const m = clientMessages("ar", "checkin.");
		expect(Object.keys(m).length).toBeGreaterThan(5);
		expect(Object.keys(m).every((k) => !k.startsWith("checkin."))).toBe(true);
		expect(m["notFound.title"]).toBe(ar["checkin.notFound.title"]);
	});
});

const event: PublicEventSummary = {
	eventId: "e1",
	title: "London Community Meetup",
	status: "on_sale",
	startsAt: "2030-03-14T18:30:00.000Z",
	timezone: "Europe/London",
	venue: "The Old Library",
	currency: "GBP",
	priceFromMinor: 1500,
	available: 0,
};

const booking: BookingView = {
	bookingRef: "ABCDEFGHJK",
	status: "awaiting_payment",
	lines: [{ ticketTypeId: "tt", qty: 2 }],
	totals: { totalMinor: 3000, currency: "GBP" },
	holdExpiresAt: "2030-03-14T18:30:00.000Z",
	attendees: [],
	canCancel: false,
};

/** Every UI helper's text in one language, for the snapshots below. */
function views(locale: string) {
	return {
		card: cardView(event, locale),
		free: formatMoney(0, "GBP", locale),
		status: statusLabel("held", locale),
		error: errorMessage("SOLD_OUT", locale),
		unknownError: errorMessage("NOPE", locale),
		field: fieldMessage("email", locale),
		waitlist: waitlistMessage("joined", locale),
		promo: promoNote({ kind: "percent", value: 1000, hiddenTypes: [] }, "GBP", locale),
		questions: questionControls(
			[
				{ id: "diet", label: "Dietary needs", type: "select", required: false, options: ["None", "Vegan"] },
				{ id: "photo", label: "Photos OK?", type: "checkbox", required: true },
			],
			"w",
			["q:photo"],
			locale,
		).map((q) => ({ hint: q.hint, message: q.message, options: q.options?.[0]?.label })),
		payment: paymentView(booking, locale),
		checkIn: checkInView(404, null, "https://hall.example", clientMessages(locale, "checkin.")),
	};
}

describe("UI text in en and ar (EU-NFR-04 snapshots)", () => {
	it("EU-NFR-04 English", () => {
		const v = views("en-GB");
		expect(v.card.badge).toBe("Sold out");
		expect(v.free).toBe("Free");
		expect(v.payment?.heading).toBe("Waiting for your payment");
		expect(v.checkIn.title).toBe("Check-in screen not available");
		expect(v).toMatchSnapshot();
	});

	it("EU-NFR-04 Arabic", () => {
		const v = views("ar");
		expect(v.card.badge).toBe(ar["list.badge.soldOut"]);
		expect(v.free).toBe(ar["money.free"]);
		expect(v.status).toBe(ar["status.held"]);
		expect(v.error).toBe(ar["widget.error.SOLD_OUT"]);
		expect(v.unknownError).toBe(ar["widget.error.INTERNAL"]);
		expect(v.payment?.heading).toBe(ar["payment.pending.heading"]);
		expect(v.checkIn.title).toBe(ar["checkin.unavailable.title"]);
		for (const text of [v.card.badge, v.card.price, v.field, v.waitlist, v.promo, v.payment?.body, v.checkIn.message])
			expect(text).toMatch(ARABIC);
		expect(v).toMatchSnapshot();
	});
});
