// Shared by the docs tests (T103).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../build.mjs";

/** Width and height of a PNG (from its IHDR chunk), or null when the bytes are not a PNG. */
export function pngSize(bytes) {
	const signature = "89504e470d0a1a0a";
	if (bytes.length < 24 || bytes.subarray(0, 8).toString("hex") !== signature) return null;
	if (bytes.subarray(12, 16).toString("ascii") !== "IHDR") return null;
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** An `emdash-plugin.jsonc` read as JSON: comment lines dropped (no comment sits inside a string). */
export function readManifest(pkg) {
	const text = readFileSync(join(repoRoot, "packages", pkg, "emdash-plugin.jsonc"), "utf8");
	return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ""));
}

/** The text of a docs page (repo-relative path), with runs of white space folded to one space. */
export function pageText(src) {
	return readFileSync(join(repoRoot, src), "utf8").replace(/\s+/g, " ");
}
