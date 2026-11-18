import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// T178: the setup check (mapping, encryption key, Turnstile) runs on the site page `/_events/setup`, so the
// sandboxed backend no longer bundles it (about 3.2 KB of the Free backend budget).
const src = fileURLToPath(new URL("../../src/", import.meta.url));
const read = (path: string) => readFileSync(join(src, path), "utf8");

/** Every source file the backend can reach: all of `src` except the site-side kit. */
function backendFiles(dir = src): string[] {
	return readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			return /[/\\](astro|integration|client|ui|i18n)$/.test(path) ? [] : backendFiles(path);
		}
		return name.endsWith(".ts") ? [path] : [];
	});
}

describe("T178 the setup check lives on the site", () => {
	it("T178 the backend imports neither the mapping nor the encryption-key check", () => {
		expect(existsSync(join(src, "domain/mapping.ts"))).toBe(false);
		expect(existsSync(join(src, "domain/encryption.ts"))).toBe(false);
		const files = backendFiles();
		expect(files.length).toBeGreaterThan(10);
		for (const file of files) {
			const text = readFileSync(file, "utf8");
			expect(text, file).not.toMatch(/lib\/(mapping|encryption)[".]/);
			expect(text, file).not.toContain("Events field mapping needs attention");
		}
	});

	it("T178 the page is for administrators, sends no secret and is never cached or indexed", () => {
		const page = read("astro/SetupPage.astro");
		expect(page).toContain("setupCheck(");
		expect(page).toContain('name="robots" content="noindex"');
		expect(page).toContain('"Cache-Control", "private, no-store"');
		expect(page).toContain("emdash/internal/routes/api/admin/plugins/_id_/settings");
		expect(page).toContain("emdash/internal/routes/api/schema");
		expect(page).toContain('data-testid="setup-forbidden"');
		expect(page).toContain("/_emdash/admin/plugins-manager/");
	});
});
