import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { CEREMONY_CSS, CEREMONY_SCRIPT, PAD_SCRIPT } from "../../src/astro/lib/assets";
import { ceremonyCsp, cspSource } from "../../src/astro/lib/csp";
import { handleSign, normaliseStrokes } from "../../src/astro/lib/sign";
import { missingForSign, pdfLinkFrom, safeDownloadHref } from "../../src/client/ceremony.js";

const root = resolve(import.meta.dirname, "../..");
const url = new URL("https://site.example/sign/TOKEN");
const DOC = "a".repeat(64);
const TOKEN = "T".repeat(43);

interface Seen {
	path: string;
	body: unknown;
}

function host(routes: Record<string, unknown>) {
	const seen: Seen[] = [];
	const handler = async (_id: string, method: string, path: string, request: Request) => {
		seen.push({ path, body: method === "POST" ? await request.clone().json() : undefined });
		return { success: true, data: routes[path] };
	};
	return { seen, ctx: { locals: { emdash: { handlePublicPluginApiRoute: handler } } as never, url } };
}

const ready = {
	ok: true,
	state: "ready",
	envelope: { id: "e1", title: "NDA", status: "in_progress", docSha256: DOC, expiresAt: null },
	signer: { name: "Ada" },
	snapshot: "Hello",
	consent: { version: "1", wording: "I agree to sign electronically." },
};

function form(entries: Record<string, string>) {
	const data = new FormData();
	for (const [k, v] of Object.entries(entries)) data.set(k, v);
	return data;
}

const signForm = { intent: "sign", typedName: "Ada", consent: "on", agree: "on" };
const submitted = (seen: Seen[]) => seen.find((s) => s.path === "public/submit")?.body as Record<string, unknown>;

describe("Sign stays disabled until consent, intent and required fields are complete (SU-FR-04)", () => {
	const complete = { typedName: "Ada", consent: true, intent: true, fields: [] };

	it("SU-FR-04 nothing is missing when every requirement is met", () => {
		expect(missingForSign(complete)).toEqual([]);
	});

	it("SU-FR-04 each missing requirement is named, in form order", () => {
		expect(missingForSign({ typedName: " ", consent: false, intent: false, fields: [] })).toEqual([
			"typedName",
			"consent",
			"agree",
		]);
		expect(missingForSign({ ...complete, consent: false })).toEqual(["consent"]);
		expect(missingForSign({ ...complete, intent: false })).toEqual(["agree"]);
	});

	it("SU-FR-05 required fields must be filled; optional ones need not be", () => {
		const fields = [
			{ name: "field.company", required: true, value: "  " },
			{ name: "field.note", required: false, value: "" },
		];
		expect(missingForSign({ ...complete, fields })).toEqual(["field.company"]);
		expect(missingForSign({ ...complete, fields: [{ ...fields[0], value: "Acme" }, fields[1]] })).toEqual([]);
	});
});

describe("signed PDF polling helpers (SU-FR-07)", () => {
	it("SU-FR-07 only a same-origin path is offered as the download link", () => {
		const origin = "https://site.example";
		expect(safeDownloadHref("/_emdash/api/plugins/semics-esign/public/download?e=1&sig=2", origin)).toBe(
			"https://site.example/_emdash/api/plugins/semics-esign/public/download?e=1&sig=2",
		);
		for (const bad of ["javascript:alert(1)", "//evil.example/x", "https://evil.example/x", "data:x", 42, null]) {
			expect(safeDownloadHref(bad, origin)).toBeUndefined();
		}
	});

	it("SU-FR-07 a session reply yields the link once the PDF is ready, and nothing before", () => {
		const origin = "https://site.example";
		const download = { url: "/x.pdf", expiresAt: "2030-01-01T00:00:00Z" };
		expect(pdfLinkFrom({ success: true, data: { ok: true, state: "closed", pdf: "ready", download } }, origin)).toBe(
			"https://site.example/x.pdf",
		);
		expect(pdfLinkFrom({ success: true, data: { ok: true, state: "closed", pdf: "pending" } }, origin)).toBeUndefined();
		expect(pdfLinkFrom({ success: true, data: { ok: false, error: { code: "X" } } }, origin)).toBeUndefined();
		expect(pdfLinkFrom({ success: false }, origin)).toBeUndefined();
		expect(pdfLinkFrom(null, origin)).toBeUndefined();
	});
});

describe("strict CSP: only the package's hashed script (SU-NFR-02)", () => {
	it("SU-NFR-02 cspSource is the base64 SHA-256 source expression of the exact text", async () => {
		expect(await cspSource("alert(1)")).toBe("'sha256-bhHHL3z2vDgxUt0W3dWQOrprscmda2Y5pLsLg4GF+pI='");
	});

	it("SU-NFR-02 the header allows only the inlined script and style, by hash, and nothing inline", async () => {
		const header = await ceremonyCsp();
		const directives = Object.fromEntries(
			header.split(";").map((d) => {
				const [name, ...values] = d.trim().split(/\s+/);
				return [name, values];
			}),
		);
		expect(directives["default-src"]).toEqual(["'none'"]);
		expect(directives["script-src"]).toEqual([await cspSource(CEREMONY_SCRIPT), await cspSource(PAD_SCRIPT)]);
		expect(directives["style-src"]).toEqual([await cspSource(CEREMONY_CSS)]);
		expect(directives["base-uri"]).toEqual(["'none'"]);
		expect(directives["form-action"]).toEqual(["'self'"]);
		expect(directives["frame-ancestors"]).toEqual(["'none'"]);
		expect(directives["connect-src"]).toEqual(["'self'"]);
		expect(header).not.toMatch(/unsafe-|\*|https?:/);
	});

	it("SU-NFR-02 the inlined script is the client module's exact source", () => {
		expect(CEREMONY_SCRIPT).toBe(readFileSync(resolve(root, "src/client/ceremony.js"), "utf8"));
	});

	it("SU-NFR-01 the ceremony renders HTML only from the package's own script and style constants", () => {
		const astro = ["SignPage.astro", "SigningCeremony.astro", "SnapshotBlocks.astro", "SnapshotInline.astro"].map((f) =>
			readFileSync(resolve(root, "src/astro", f), "utf8"),
		);
		const uses = astro.flatMap((src) => [...src.matchAll(/set:html=\{([^}]*)\}/g)].map((m) => m[1]));
		expect(uses.sort()).toEqual(["CEREMONY_CSS", "CEREMONY_SCRIPT", "PAD_SCRIPT"]);
		for (const src of astro) expect(src).not.toMatch(/innerHTML|set:text|is:raw/);
		expect(readFileSync(resolve(root, "src/client/ceremony.js"), "utf8")).not.toMatch(
			/innerHTML|outerHTML|insertAdjacentHTML|eval\(/,
		);
	});
});

describe("drawn signatures and field values in handleSign (SU-FR-05, SU-FR-06)", () => {
	it("SU-FR-06 pad strokes { v, w, h, strokes } are normalised to 0-1 points for public/submit", () => {
		expect(normaliseStrokes({ v: 1, w: 200, h: 100, strokes: [[[0, 0], [100, 50], { x: 200, y: 100 }]] })).toEqual({
			ok: true,
			strokes: [
				[
					[0, 0],
					[0.5, 0.5],
					[1, 1],
				],
			],
		});
		// Out-of-pad points are clamped, malformed points and empty strokes dropped, precision capped.
		expect(
			normaliseStrokes({
				w: 3,
				h: 3,
				strokes: [
					[
						[1, 2],
						[-5, 9],
						["x", 1],
					],
					[],
				],
			}),
		).toEqual({
			ok: true,
			strokes: [
				[
					[0.333, 0.667],
					[0, 1],
				],
			],
		});
	});

	it("SU-FR-06 unusable or oversized strokes are refused before anything is sent", () => {
		for (const bad of [
			null,
			"x",
			{ w: 0, h: 1, strokes: [[[0, 0]]] },
			{ w: 1, h: 1, strokes: [] },
			{ w: 1, h: 1, strokes: [[["a"]]] },
		]) {
			expect(normaliseStrokes(bad)).toEqual({ ok: false, code: "INVALID_SIGNATURE" });
		}
		const many = { w: 1, h: 1, strokes: Array.from({ length: 65 }, () => [[0.1, 0.1]]) };
		expect(normaliseStrokes(many)).toEqual({ ok: false, code: "INVALID_SIGNATURE" });
		const big = {
			w: 1,
			h: 1,
			strokes: Array.from({ length: 8 }, () => Array.from({ length: 400 }, () => [0.123, 0.456])),
		};
		expect(normaliseStrokes(big)).toEqual({ ok: false, code: "STROKES_TOO_LARGE" });
	});

	it("SU-FR-06 a drawn signature posts kind drawn with the typed name and the normalised strokes", async () => {
		const h = host({ "public/session": ready, "public/submit": { ok: true } });
		const strokes = JSON.stringify({
			v: 1,
			w: 100,
			h: 100,
			strokes: [
				[
					[10, 20],
					[30, 40],
				],
			],
		});
		const view = await handleSign(h.ctx, TOKEN, form({ ...signForm, signatureStrokes: strokes }));
		expect(view.kind).toBe("signed");
		expect(submitted(h.seen)).toEqual({
			token: TOKEN,
			docSha256: DOC,
			consent: true,
			intent: true,
			signature: {
				kind: "drawn",
				typedName: "Ada",
				strokes: [
					[
						[0.1, 0.2],
						[0.3, 0.4],
					],
				],
			},
			fieldValues: {},
		});
	});

	it("SU-FR-06 bad stroke JSON re-renders the ceremony with the signature to fix and submits nothing", async () => {
		for (const [strokes, code] of [
			["{not json", "BAD_REQUEST"],
			[
				JSON.stringify({
					w: 1,
					h: 1,
					strokes: Array.from({ length: 8 }, () => Array.from({ length: 400 }, () => [0.123, 0.456])),
				}),
				"STROKES_TOO_LARGE",
			],
		] as const) {
			const h = host({ "public/session": ready, "public/submit": { ok: true } });
			const view = await handleSign(h.ctx, TOKEN, form({ ...signForm, signatureStrokes: strokes }));
			expect(view).toMatchObject({ kind: "ready", fields: ["signature"], errorCode: code });
			expect(h.seen.map((s) => s.path)).toEqual(["public/session"]);
		}
	});

	it("SU-FR-06 an empty stroke field (no JS, or a cleared pad) is a typed signature", async () => {
		const h = host({ "public/session": ready, "public/submit": { ok: true } });
		await handleSign(h.ctx, TOKEN, form({ ...signForm, signatureStrokes: "" }));
		expect(submitted(h.seen).signature).toEqual({ kind: "typed", typedName: "Ada" });
	});

	it("SU-FR-05 declared fields are posted as fieldValues; required ones block the submit; unknown ones are ignored", async () => {
		const session = {
			...ready,
			fields: [
				{ key: "company", label: "Company", required: true },
				{ key: "note", label: "Note" },
			],
		};
		const h = host({ "public/session": session, "public/submit": { ok: true } });
		const missing = await handleSign(h.ctx, TOKEN, form({ ...signForm, "field.note": "hi" }));
		expect(missing).toMatchObject({ kind: "ready", fields: ["field.company"], errorCode: "BAD_REQUEST" });
		expect(h.seen.map((s) => s.path)).toEqual(["public/session"]);

		const h2 = host({ "public/session": session, "public/submit": { ok: true } });
		await handleSign(h2.ctx, TOKEN, form({ ...signForm, "field.company": " Acme ", "field.evil": "x" }));
		expect(submitted(h2.seen).fieldValues).toEqual({ company: "Acme" });
	});

	it("SU-FR-04 the core's issue paths map to the form's own fields", async () => {
		const h = host({
			"public/session": ready,
			"public/submit": {
				ok: false,
				error: { code: "BAD_REQUEST", message: "no" },
				issues: [
					{ path: "intent", code: "INTENT_REQUIRED" },
					{ path: "signature.strokes", code: "STROKES_TOO_LARGE" },
					{ path: "fieldValues", code: "INVALID_FIELDS" },
				],
			},
		});
		const view = await handleSign(h.ctx, TOKEN, form(signForm));
		expect(view).toMatchObject({ kind: "ready", fields: ["agree", "signature", "fields"] });
	});
});
