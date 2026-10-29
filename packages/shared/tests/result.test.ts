import { readFileSync } from "node:fs";
import { describe, expect, expectTypeOf, it } from "vitest";
import {
	ERROR_CODES,
	type ErrorCode,
	EVENTS_ERROR_CODES,
	err,
	isErr,
	isOk,
	ok,
	type Result,
	routeErrorFrom,
	toRouteError,
} from "../src/index";

const specPath = new URL("../../../docs/protocol/esign-intent-v1.md", import.meta.url);

/** Protocol §9: codes and statuses parsed from the spec so the registry cannot drift. */
function protocolCodes(): Map<string, number> {
	const spec = readFileSync(specPath, "utf8");
	const section = spec.slice(spec.indexOf("## 9. Error codes"), spec.indexOf("## 10."));
	const codes = new Map<string, number>();
	for (const line of section.split("\n")) {
		const row = /^\| `([A-Z_]+)` \|.*\| (\d{3}) \|$/.exec(line);
		if (row) codes.set(row[1] as string, Number(row[2]));
	}
	for (const m of section.matchAll(/`([A-Z_]+)` \((?:[^)]*, )?(\d{3})\)/g)) {
		codes.set(m[1] as string, Number(m[2]));
	}
	return codes;
}

describe("error registry", () => {
	const entries = Object.entries(ERROR_CODES);

	it("has well-formed, unique codes", () => {
		const names = entries.map(([code]) => code);
		expect(new Set(names).size).toBe(names.length);
		for (const code of names) expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
	});

	it("maps each code to exactly one valid status and a non-empty safe message", () => {
		for (const [code, def] of entries) {
			expect(Object.keys(def).sort()).toEqual(["message", "status"]);
			expect(Number.isInteger(def.status) && def.status >= 400 && def.status <= 599).toBe(true);
			expect(def.message.length).toBeGreaterThan(0);
			expect(toRouteError(code)).toEqual({
				status: def.status,
				body: { ok: false, error: { code, message: def.message } },
			});
		}
	});

	it("is frozen", () => {
		expect(Object.isFrozen(ERROR_CODES)).toBe(true);
		for (const def of Object.values(ERROR_CODES)) expect(Object.isFrozen(def)).toBe(true);
	});

	it("contains every protocol §9 code with the spec's status", () => {
		const spec = protocolCodes();
		expect(spec.size).toBeGreaterThanOrEqual(15);
		for (const [code, status] of spec) {
			expect(ERROR_CODES, code).toHaveProperty(code);
			expect(ERROR_CODES[code as ErrorCode].status, code).toBe(status);
		}
	});

	it("R31 SESSION_REQUIRED is a 409 asking the signer to reopen the page", () => {
		expect(ERROR_CODES.SESSION_REQUIRED.status).toBe(409);
		expect(toRouteError("SESSION_REQUIRED")).toEqual({
			status: 409,
			body: { ok: false, error: { code: "SESSION_REQUIRED", message: ERROR_CODES.SESSION_REQUIRED.message } },
		});
	});

	it("contains the seeded PRD codes", () => {
		for (const code of [
			"BAD_REQUEST",
			"NOT_FOUND",
			"RATE_LIMITED",
			"TURNSTILE_FAILED",
			"TOKEN_IN_QUERY",
			"INTERNAL",
			"SOLD_OUT",
			"HOLD_EXPIRED",
			"SALES_CLOSED",
			"BOOKING_TOKEN_INVALID",
			"BOOKING_TOKEN_EXPIRED",
			"PAYMENT_FAILED",
			"LICENCE_INVALID",
			"LICENCE_EXPIRED",
		]) {
			expect(ERROR_CODES, code).toHaveProperty(code);
		}
	});
});

describe("toRouteError", () => {
	it("accepts a code string, an object with a code, or an Error with a code", () => {
		const expected = toRouteError("SOLD_OUT");
		expect(expected.status).toBe(409);
		expect(toRouteError({ code: "SOLD_OUT" })).toEqual(expected);
		expect(toRouteError(Object.assign(new Error("db row 7 locked"), { code: "SOLD_OUT" }))).toEqual(expected);
	});

	it("uses the registry message, not the thrown message, for known codes", () => {
		const out = toRouteError(Object.assign(new Error("secret detail"), { code: "SOLD_OUT" }));
		expect(JSON.stringify(out)).not.toContain("secret detail");
	});

	it.each([
		["an Error", new Error("password=hunter2 at /srv/app.js:1")],
		["a string", "boom: hunter2"],
		["an unknown code", { code: "NOPE", message: "hunter2" }],
		["a prototype key", { code: "toString" }],
		["a non-string code", { code: 5, message: "hunter2" }],
		["null", null],
		["undefined", undefined],
		["a number", 42],
	])("maps %s to 500 INTERNAL without leaking", (_label, input) => {
		const out = toRouteError(input);
		expect(out.status).toBe(500);
		expect(out.body).toEqual({
			ok: false,
			error: { code: "INTERNAL", message: ERROR_CODES.INTERNAL.message },
		});
		expect(JSON.stringify(out)).not.toContain("hunter2");
		expect(JSON.stringify(out)).not.toContain("app.js");
	});
});

describe("Result", () => {
	it("builds and narrows ok and err values", () => {
		const make = (fail: boolean): Result<number, string> => (fail ? err("no") : ok(1));
		const good = make(false);
		const bad = make(true);
		expect(good).toEqual({ ok: true, value: 1 });
		expect(bad).toEqual({ ok: false, error: "no" });
		expect(isOk(good)).toBe(true);
		expect(isErr(good)).toBe(false);
		expect(isOk(bad)).toBe(false);
		expect(isErr(bad)).toBe(true);
		if (isOk(good)) expectTypeOf(good.value).toBeNumber();
		if (isErr(bad)) expectTypeOf(bad.error).toBeString();
		if (good.ok) expectTypeOf(good.value).toBeNumber();
		else expectTypeOf(good.error).toBeString();
	});
});

describe("booking token errors (T049)", () => {
	it("a wrong booking token looks like a missing booking, so it never confirms a booking exists", () => {
		expect(ERROR_CODES.BOOKING_TOKEN_INVALID.status).toBe(404);
		expect(ERROR_CODES.BOOKING_TOKEN_INVALID.message).toBe(ERROR_CODES.NOT_FOUND.message);
	});
});

describe("Events code table (R96)", () => {
	it("is a frozen subset of the registry with the same statuses and messages", () => {
		expect(Object.isFrozen(EVENTS_ERROR_CODES)).toBe(true);
		for (const [code, def] of Object.entries(EVENTS_ERROR_CODES)) {
			expect(def, code).toEqual(ERROR_CODES[code as ErrorCode]);
		}
		for (const code of ["INTERNAL", "NOT_FOUND", "HOLD_EXPIRED", "PAYMENT_FAILED", "TOKEN_INVALID", "REF_UNKNOWN"]) {
			expect(EVENTS_ERROR_CODES, code).toHaveProperty(code);
		}
	});

	it("leaves the e-sign and other protocol messages out", () => {
		for (const code of ["ENVELOPE_NOT_FOUND", "SIGNING_OUT_OF_TURN", "TOKEN_MALFORMED", "TEMPLATE_NOT_FOUND"]) {
			expect(EVENTS_ERROR_CODES, code).not.toHaveProperty(code);
		}
	});

	it("routeErrorFrom answers a code outside its table as INTERNAL", () => {
		expect(routeErrorFrom(EVENTS_ERROR_CODES, "SOLD_OUT")).toEqual(toRouteError("SOLD_OUT"));
		expect(routeErrorFrom(EVENTS_ERROR_CODES, { code: "TOKEN_MALFORMED" })).toEqual(toRouteError("INTERNAL"));
	});
});
