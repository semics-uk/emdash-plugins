import { describe, expect, it } from "vitest";
import { completionEmail, invitationEmail } from "../src/emails/templates";

const BASE = { to: "ada@example.com", signerName: "Ada Lovelace", title: "Waiver", sender: "Acme Theatre" };
const LINK = "https://site.test/sign/abc-DEF_123";
const DOWNLOAD = "https://site.test/_emdash/api/plugins/semics-esign/public/download?e=x&exp=1&sig=y";

describe("ES-FR-10 email templates", () => {
	it("invitation: snapshot", () => {
		expect(invitationEmail({ ...BASE, link: LINK, expiresAt: "2026-11-04T10:00:00.000Z" })).toMatchSnapshot();
	});

	it("completion: snapshot", () => {
		expect(completionEmail({ ...BASE, link: DOWNLOAD })).toMatchSnapshot();
	});

	it("invitation carries the link verbatim (tokens contain - and _), addressed to the signer", () => {
		const m = invitationEmail({ ...BASE, link: LINK, expiresAt: "2026-11-04T10:00:00.000Z" });
		expect(m.to).toBe("ada@example.com");
		expect(m.subject).toBe("Acme Theatre asks you to sign: Waiver");
		expect(m.text).toContain(LINK);
		expect(m.html).toContain(`href="${LINK}"`);
		expect(m.text).toContain("4 November 2026");
	});

	it("completion links the download, with the query's & escaped in HTML only", () => {
		const m = completionEmail({ ...BASE, link: DOWNLOAD });
		expect(m.subject).toBe("Signed: Waiver");
		expect(m.text).toContain(DOWNLOAD);
		expect(m.html).toContain("e=x&amp;exp=1&amp;sig=y");
	});

	it("escapes names and titles in HTML but keeps them readable in text", () => {
		const m = invitationEmail({
			...BASE,
			signerName: 'Mary-Jane <b>"O\'Neil"</b>',
			title: "R&D waiver",
			link: LINK,
			expiresAt: null,
		});
		expect(m.text).toContain('Mary-Jane <b>"O\'Neil"</b>');
		expect(m.html).not.toContain("<b>");
		expect(m.html).toContain("Mary-Jane &lt;b&gt;&quot;O&#39;Neil&quot;&lt;/b&gt;");
		expect(m.html).toContain("R&amp;D waiver");
		expect(m.text).not.toContain("expires");
	});

	it("a title cannot inject a line break into the subject", () => {
		const m = completionEmail({ ...BASE, title: "A\r\nBcc: x@evil.test", link: LINK });
		expect(m.subject).not.toMatch(/[\r\n]/);
	});
});
