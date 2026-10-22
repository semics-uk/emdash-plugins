import { describe, expect, it } from "vitest";

import { startMessage } from "../../src/astro/lib/self-serve";
import { pdfDocumentView, type SessionData, signMessage } from "../../src/astro/lib/sign";
import { missingNote } from "../../src/client/ceremony.js";
import { ar } from "../../src/i18n/ar";
import { en } from "../../src/i18n/en";
import { clientMessages, directionOf, LANGUAGES, languageOf, translator } from "../../src/i18n/index";

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const ARABIC = /[؀-ۿ]/;

describe("translations (SU-NFR-06, T102)", () => {
	it("SU-NFR-06 every language has every English key, none empty, with the same placeholders", () => {
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

	it("SU-NFR-06 the Arabic table is Arabic", () => {
		for (const [key, text] of Object.entries(ar)) {
			const words = text.replace(/\{\w+\}/g, "");
			if (/\p{L}/u.test(words)) expect(words, key).toMatch(ARABIC);
		}
	});

	it("SU-NFR-06 a locale picks its language and direction; an unknown one falls back to English", () => {
		expect(languageOf("ar-SA")).toBe("ar");
		expect(languageOf("en")).toBe("en");
		expect(languageOf("de")).toBe("en");
		expect(directionOf("ar")).toBe("rtl");
		expect(directionOf(undefined)).toBe("ltr");
		expect(translator("ar").t("sign.decline.button")).toBe(ar["sign.decline.button"]);
	});
});

const session = (bytes: number, pages: number): SessionData => ({
	ok: true,
	state: "ready",
	envelope: { id: "e", title: "NDA", status: "in_progress", docSha256: "0".repeat(64), expiresAt: null },
	signer: { name: "Ada" },
	snapshot: "",
	document: { kind: "pdf", name: "contract.pdf", bytes, pages },
});

/** Every UI helper's text in one language, for the snapshots below. */
function views(locale: string) {
	const m = clientMessages(locale, "ceremony.");
	return {
		token: signMessage("SIGNING_TOKEN_EXPIRED", locale),
		unknown: signMessage("NOPE", locale),
		otp: signMessage("OTP_INVALID", locale),
		start: startMessage("SELF_SERVE_FULL", locale),
		pdf: pdfDocumentView(session(48_128, 3), locale),
		onePage: pdfDocumentView(session(2_400_000, 1), locale),
		missing: missingNote(["typedName", "consent", "field.company"], m, { "field.company": "Company" }, locale),
	};
}

describe("UI text in en and ar (SU-NFR-06 snapshots)", () => {
	it("SU-NFR-06 English", () => {
		const v = views("en");
		expect(v.token).toBe("This signing link has expired. Ask the sender for a new one.");
		expect(v.pdf?.size).toBe("47 KB");
		expect(v.missing).toBe("To sign, please type your full name, tick the consent box, fill in Company.");
		expect(v).toMatchSnapshot();
	});

	it("SU-NFR-06 Arabic", () => {
		const v = views("ar");
		expect(v.token).toBe(ar["error.SIGNING_TOKEN_EXPIRED"]);
		expect(v.unknown).toBe(ar["error.INTERNAL"]);
		expect(v.start).toBe(ar["selfServe.error.SELF_SERVE_FULL"]);
		for (const text of [v.otp, v.pdf?.pagesLabel, v.onePage?.pagesLabel, v.missing]) expect(text).toMatch(ARABIC);
		expect(v.missing).toContain("Company");
		expect(v).toMatchSnapshot();
	});
});
