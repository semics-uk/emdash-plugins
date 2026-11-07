import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
	applyFields,
	collectFields,
	KEPT_MS,
	type KeptField,
	keptKey,
	saveKept,
	takeKept,
} from "../src/astro/lib/keep-form";

// A refused booking comes back with what was typed (LMSC staging, PV52PKY5AK), held in this tab's storage: personal
// details never go in the URL or through the server.

const field = (name: string, type: string, value = "", checked?: boolean): KeptField => ({
	name,
	type,
	value,
	...(checked === undefined ? {} : { checked }),
});

function memory() {
	const data = new Map<string, string>();
	return {
		data,
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		removeItem: (k: string) => void data.delete(k),
	};
}

const FORM = () => [
	field("intent", "hidden", "book"),
	field("idempotencyKey", "hidden", "secret-key"),
	field("cf-turnstile-response", "hidden", "token"),
	field("occurrenceId", "select-one", "oc_2"),
	field("name", "text", "Ada Lovelace"),
	field("email", "email", "ada@example.com"),
	field("attendee.2.name", "text", "Byron"),
	field("attendee.2.email", "email", ""),
	field("attendee.2.minor", "checkbox", "on", true),
	field("attendee.3.minor", "checkbox", "on", false),
	field("", "submit", "Book"),
];
const REFUSED = new URLSearchParams({ waiver_error: "WAIVER_EMAIL_REQUIRED", waiver_event: "ev1" });
const NOW = 1_000_000;

describe("keeping a refused form", () => {
	it("SX-FR-02 keeps the date, the time and the details; never hidden fields, the key or the check's token", () => {
		expect(collectFields(FORM())).toEqual({
			occurrenceId: "oc_2",
			name: "Ada Lovelace",
			email: "ada@example.com",
			"attendee.2.name": "Byron",
			"attendee.2.minor": true,
		});
	});

	it("SX-FR-02 puts them back after a refusal of this event's form, once", () => {
		const s = memory();
		saveKept(s, "ev1", FORM(), NOW);
		const kept = takeKept(s, "ev1", REFUSED, NOW + 1000);
		const blank = FORM().map((f) => ({
			...f,
			value: f.type === "hidden" || f.type === "checkbox" ? f.value : "",
			checked: false,
		}));
		applyFields(blank, kept ?? {});
		const by = (name: string) => blank.find((f) => f.name === name);
		expect(by("occurrenceId")?.value).toBe("oc_2");
		expect(by("email")?.value).toBe("ada@example.com");
		expect(by("attendee.2.minor")?.checked).toBe(true);
		expect(by("attendee.3.minor")?.checked).toBe(false);
		expect(by("idempotencyKey")?.value).toBe("secret-key");
		expect(takeKept(s, "ev1", REFUSED, NOW + 2000)).toBeNull();
	});

	it("SX-FR-02 a date that has since gone is not chosen again, so the form asks for one (after SOLD_OUT)", () => {
		const select = (disabled: boolean) => ({
			...field("occurrenceId", "select-one", ""),
			options: [
				{ value: "", disabled: false },
				{ value: "oc_2", disabled },
			],
		});
		const gone = select(true);
		applyFields([gone], { occurrenceId: "oc_2" });
		expect(gone.value).toBe("");
		const open = select(false);
		applyFields([open], { occurrenceId: "oc_2" });
		expect(open.value).toBe("oc_2");
	});

	it("SX-FR-02 Back to the refusal's URL after booking fills in nothing, and forgets", () => {
		const s = memory();
		saveKept(s, "ev1", FORM(), NOW);
		expect(takeKept(s, "ev1", REFUSED, NOW + 1000, true)).toBeNull();
		expect(s.data.has(keptKey("ev1"))).toBe(false);
	});

	it("SX-FR-02 storage access that throws cannot stop the picker's script, and the booking page uses the same key", () => {
		const source = readFileSync(new URL("../src/astro/lib/keep-form.ts", import.meta.url), "utf8");
		expect(source).toMatch(
			/try \{\n\tif \(typeof document !== "undefined"\) keepWaiverForms\(document, sessionStorage/,
		);
		const forget = readFileSync(new URL("../../events/src/client/forget-form.ts", import.meta.url), "utf8");
		expect(forget).toContain(`"${keptKey("")}"`);
	});

	it("SX-FR-02 any other visit discards them, as does a refusal of another widget or a stale entry", () => {
		const s = memory();
		saveKept(s, "ev1", FORM(), NOW);
		expect(takeKept(s, "ev1", new URLSearchParams(), NOW)).toBeNull();
		expect(s.data.has(keptKey("ev1"))).toBe(false);

		saveKept(s, "ev1", FORM(), NOW);
		expect(takeKept(s, "ev1", new URLSearchParams({ waiver_error: "X", waiver_event: "other" }), NOW)).toBeNull();

		saveKept(s, "ev1", FORM(), NOW);
		expect(takeKept(s, "ev1", REFUSED, NOW + KEPT_MS + 1)).toBeNull();
	});

	it("SX-FR-02 storage that refuses never gets in the way", () => {
		const broken = {
			getItem: () => {
				throw new Error("denied");
			},
			setItem: () => {
				throw new Error("denied");
			},
			removeItem: () => undefined,
		};
		expect(() => saveKept(broken, "ev1", FORM(), NOW)).not.toThrow();
		expect(takeKept(broken, "ev1", REFUSED, NOW)).toBeNull();
	});
});
