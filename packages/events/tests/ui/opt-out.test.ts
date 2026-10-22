/**
 * The opt-out page for reminder and update emails (EV-FR-08, T083, R57). Events Pro's emails link to
 * `/_events/opt-out?ref=&w=&s=` (booking ref, recipient, signature). Opening the link changes
 * nothing, so a mail scanner that prefetches it cannot unsubscribe anyone: the page shows a button,
 * and only its same-site POST asks the core's `public/mail/opt-out` (a Pro route; Free answers
 * NOT_FOUND, which reads as an invalid link).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { OPT_OUT_MESSAGES, OPT_OUT_PATH, optOut, readOptOutLink } from "../../src/astro/lib/opt-out";

const url = new URL(`https://site.example${OPT_OUT_PATH}`);
const REF = "ABCDEFGHJK";
const SIG = "0123456789abcdef0123456789abcdef";
const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

function host(answers: Record<string, unknown>) {
	const seen: Array<{ path: string; body: unknown }> = [];
	const handler = async (_id: string, method: string, path: string, request: Request) => {
		seen.push({ path, body: method === "POST" ? await request.clone().json() : undefined });
		return answers[path] ?? { success: false, error: { code: "NOT_FOUND", message: "no route" } };
	};
	return { seen, ctx: { url, locals: { emdash: { handlePublicPluginApiRoute: handler } } as never } };
}

describe("/_events/opt-out (EV-FR-08)", () => {
	it("EV-FR-08 reads the booking ref, the recipient and the signature from the link", () => {
		const q = new URLSearchParams({ ref: REF, w: "buyer", s: SIG });
		expect(readOptOutLink(q)).toEqual({ bookingRef: REF, who: "buyer", sig: SIG });
		const seat = new URLSearchParams({ ref: REF, w: "bk_1-2", s: SIG });
		expect(readOptOutLink(seat)).toEqual({ bookingRef: REF, who: "bk_1-2", sig: SIG });
	});

	it("EV-FR-08 refuses malformed links before anything is asked", () => {
		for (const q of [
			{ ref: "short", w: "buyer", s: SIG },
			{ ref: REF, w: "", s: SIG },
			{ ref: REF, w: "a b", s: SIG },
			{ ref: REF, w: "buyer", s: "nothex" },
			{ ref: REF, w: "buyer" },
		]) {
			expect(readOptOutLink(new URLSearchParams(q as Record<string, string>))).toBeNull();
		}
	});

	it("EV-FR-08 the POST asks public/mail/opt-out with the link's values and reports done", async () => {
		const h = host({ "public/mail/opt-out": { success: true, data: { ok: true } } });
		const out = await optOut(h.ctx, { bookingRef: REF, who: "buyer", sig: SIG }, {});
		expect(out).toBe("done");
		expect(h.seen).toEqual([{ path: "public/mail/opt-out", body: { bookingRef: REF, who: "buyer", sig: SIG } }]);
		expect(OPT_OUT_MESSAGES.done).toMatch(/no more reminders/i);
	});

	it("EV-FR-08 a refusal or a core without the route (Free) reads as an invalid link", async () => {
		const refused = host({
			"public/mail/opt-out": { success: true, data: { ok: false, error: { code: "NOT_FOUND", message: "no" } } },
		});
		expect(await optOut(refused.ctx, { bookingRef: REF, who: "buyer", sig: SIG }, {})).toBe("invalid");
		const free = host({});
		expect(await optOut(free.ctx, { bookingRef: REF, who: "buyer", sig: SIG }, {})).toBe("invalid");
		expect(OPT_OUT_MESSAGES.invalid).toMatch(/not valid/i);
	});

	it("EV-FR-08 the page checks the origin before it reads the form, and opening it calls nothing", () => {
		const page = read("../../src/astro/OptOutPage.astro");
		const guard = page.indexOf("isCrossSiteRequest(Astro.request");
		expect(guard).toBeGreaterThan(-1);
		expect(guard).toBeLessThan(page.indexOf("Astro.request.formData()"));
		expect(page.indexOf("optOut(")).toBeGreaterThan(page.indexOf('Astro.request.method === "POST"'));
		expect(page).toContain('name="robots" content="noindex"');
		expect(page).not.toContain("set:html");
		expect(read("../../package.json")).toContain('"./astro/OptOutPage.astro": "./src/astro/OptOutPage.astro"');
	});
});
