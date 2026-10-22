import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

import { VERIFY_CSS, VERIFY_SCRIPT } from "../../src/astro/lib/assets";
import { cspSource, verifyCsp } from "../../src/astro/lib/csp";
import { enhanceVerify, sha256Hex } from "../../src/client/verify.js";
import { en } from "../../src/i18n/en";
import { clientMessages } from "../../src/i18n/index";

const root = resolve(import.meta.dirname, "../..");
const ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

type Listener = (event: Record<string, unknown>) => unknown;

/** A just-enough DOM: the file input, the drop zone, the text field, the form and the status line. */
function dom() {
	const listeners = new Map<string, Listener>();
	const zoneListeners = new Map<string, Listener>();
	const target = { value: "" };
	const status = { textContent: "" };
	const form = { requestSubmit: vi.fn() };
	const file = {
		hidden: true,
		// The page renders the script's messages in its language (T102); the script has none of its own.
		dataset: { target: "sha", status: "sha-status", messages: JSON.stringify(clientMessages("en", "verify.")) },
		files: [] as unknown[],
		closest: (sel: string) => (sel === "form" ? form : null),
		addEventListener: (type: string, fn: Listener) => listeners.set(type, fn),
	};
	const zone = {
		classList: { toggle: vi.fn() },
		addEventListener: (type: string, fn: Listener) => zoneListeners.set(type, fn),
	};
	const doc = {
		querySelectorAll: (sel: string) =>
			sel === "input[data-esign-file]" ? [file] : sel === "[data-esign-drop]" ? [zone] : [],
		getElementById: (id: string) => (id === "sha" ? target : id === "sha-status" ? status : null),
	};
	return { doc, file, zone, target, status, form, listeners, zoneListeners };
}

const pdf = (text: string) => ({ name: "signed.pdf", arrayBuffer: async () => new TextEncoder().encode(text).buffer });

describe("verify page client (SU-FR-02, ES-US-6)", () => {
	it("ES-US-6 sha256Hex is the lower-case hex SHA-256 of the bytes", async () => {
		expect(await sha256Hex(new TextEncoder().encode("abc").buffer as ArrayBuffer)).toBe(ABC);
	});

	it("ES-US-6 choosing a file fills the fingerprint, says so, and submits only that field", async () => {
		const d = dom();
		enhanceVerify(d.doc as never);
		expect(d.file.hidden).toBe(false);
		d.file.files = [pdf("abc")];
		await d.listeners.get("change")?.({});
		expect(d.target.value).toBe(ABC);
		expect(d.status.textContent).toMatch(/signed\.pdf/);
		expect(d.form.requestSubmit).toHaveBeenCalledOnce();
		// The file control has no name, so a form post cannot carry the file.
		expect((d.file as Record<string, unknown>).name).toBeUndefined();
	});

	it("ES-US-6 dropping a PDF on the zone hashes it the same way", async () => {
		const d = dom();
		enhanceVerify(d.doc as never);
		const preventDefault = vi.fn();
		d.zoneListeners.get("dragover")?.({ preventDefault });
		expect(preventDefault).toHaveBeenCalled();
		await d.zoneListeners.get("drop")?.({ preventDefault, dataTransfer: { files: [pdf("abc")] } });
		expect(d.target.value).toBe(ABC);
		expect(d.form.requestSubmit).toHaveBeenCalledOnce();
	});

	it("ES-US-6 an unreadable file reports an error and submits nothing", async () => {
		const d = dom();
		enhanceVerify(d.doc as never);
		d.file.files = [{ name: "x.pdf", arrayBuffer: async () => Promise.reject(new Error("nope")) }];
		await d.listeners.get("change")?.({});
		expect(d.target.value).toBe("");
		expect(d.status.textContent).toMatch(/could not read/i);
		expect(d.form.requestSubmit).not.toHaveBeenCalled();
	});

	it("SU-NFR-02 the script can send nothing anywhere: no fetch, XHR, beacon, FormData or websocket", () => {
		const source = readFileSync(resolve(root, "src/client/verify.js"), "utf8");
		expect(source).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|FormData|WebSocket|innerHTML/);
		expect(VERIFY_SCRIPT).toBe(source);
	});

	it("SU-NFR-02 the verify page's CSP allows only its own hashed script and style, and posts to the site", async () => {
		const header = await verifyCsp();
		const directives = Object.fromEntries(
			header.split(";").map((d) => {
				const [name, ...values] = d.trim().split(/\s+/);
				return [name, values];
			}),
		);
		expect(directives["default-src"]).toEqual(["'none'"]);
		expect(directives["script-src"]).toEqual([await cspSource(VERIFY_SCRIPT)]);
		expect(directives["style-src"]).toEqual([await cspSource(VERIFY_CSS)]);
		expect(directives["connect-src"]).toBeUndefined();
		expect(directives["form-action"]).toEqual(["'self'"]);
		expect(directives["frame-ancestors"]).toEqual(["'none'"]);
		expect(header).not.toMatch(/unsafe-|\*|https?:/);
	});

	it("R45 a fingerprint that is not found says signed records are deleted after their retention period", () => {
		const page = readFileSync(resolve(root, "src/astro/VerifyDocument.astro"), "utf8");
		expect(page).toContain('data-testid="verify-retention"');
		// The text lives in the translation tables since T102.
		expect(page).toContain('t("verify.retention")');
		expect(en["verify.retention"]).toMatch(/deleted when their retention\s+period ends/);
	});
});
