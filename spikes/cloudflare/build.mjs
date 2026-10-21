// Generates gen/modules.js: the sandboxed probe sources as strings, so the host Worker can hand
// them to the Worker Loader (the same way EmDash passes a plugin's backend.js), and
// gen/wrangler.jsonc from the template with the D1 id passed in PROBE_D1_ID (never committed).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), "utf8");

mkdirSync(join(here, "gen"), { recursive: true });
const modules = {
	plugin: read("src/plugin.js"),
	pdfMini: read("src/pdf-mini.js"),
	pluginPdflib: read("src/plugin-pdflib.js"),
	pdfLib: read("node_modules/pdf-lib/dist/pdf-lib.esm.min.js"),
};
writeFileSync(
	join(here, "gen/modules.js"),
	Object.entries(modules)
		.map(([k, v]) => `export const ${k} = ${JSON.stringify(v)};`)
		.join("\n"),
);

const id = process.env.PROBE_D1_ID ?? "00000000-0000-0000-0000-000000000000";
writeFileSync(join(here, "gen/wrangler.jsonc"), read("wrangler.template.jsonc").replace("__PROBE_D1_ID__", id));
console.log("built gen/modules.js and gen/wrangler.jsonc");
