import { describe, expect, it } from "vitest";

import { forgetKeptForms } from "../../src/client/forget-form";

describe("the booking page forgets the form's kept details", () => {
	it("removes every kept form and nothing else", () => {
		const data = new Map([
			["semics-waiver-form:ev1", "{}"],
			["other", "1"],
			["semics-waiver-form:ev2", "{}"],
		]);
		forgetKeptForms({
			get length() {
				return data.size;
			},
			key: (i: number) => [...data.keys()][i] ?? null,
			removeItem: (k: string) => void data.delete(k),
		});
		expect([...data.keys()]).toEqual(["other"]);
	});
});
