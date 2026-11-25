import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { relative } from "node:path";
import test from "node:test";

import { quietCatches, serverFiles } from "./catch-check.mjs";

test("T185 a bare catch with nothing to say is flagged", () => {
	assert.deepEqual(quietCatches("try {\n\ta();\n} catch {\n\treturn null;\n}\n"), [3]);
	assert.deepEqual(quietCatches("const v = await read().catch(() => null);\n"), [1]);
	assert.deepEqual(quietCatches("} catch (e) {\n\treturn fail(INTERNAL);\n}\n"), [1]);
});

test("T185 a catch that reports, logs, rethrows or explains itself passes", () => {
	for (const source of [
		"} catch {\n\t// Not JSON: the status speaks for it.\n\treturn null;\n}",
		"// Quiet on purpose: the sweep retries.\nawait write().catch(() => undefined);",
		'} catch (e) {\n\treport(log, "error", "x.failed");\n}',
		'} catch (e) {\n\tsiteLog("warn", "x");\n}',
		'} catch (e) {\n\tctx.log.error("x");\n}',
		'} catch (e) {\n\tthrow new RangeError("bad");\n}',
		'} catch (e) {\n\treturn err("PARSE");\n}',
	]) {
		assert.deepEqual(quietCatches(source), [], source);
	}
});

test("T185 (#79) every server catch in the packages reports, rethrows or says why it is quiet", () => {
	const files = serverFiles();
	assert.ok(
		files.some((f) => f.includes("/routes/")),
		"found the route sources",
	);
	assert.ok(!files.some((f) => f.includes("/src/client/")), "browser code is out of scope");
	const found = files.flatMap((file) =>
		quietCatches(readFileSync(file, "utf8")).map((line) => `${relative(process.cwd(), file)}:${line}`),
	);
	assert.deepEqual(found, [], "report it, rethrow it, or add a comment saying why (node scripts/catch-check.mjs)");
});
