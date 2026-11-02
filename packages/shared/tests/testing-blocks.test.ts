import { describe, expect, it } from "vitest";

import { form, numberInput, repeater, textInput } from "../src/index";
import { formFields, renderBlocks, undrawnFields } from "../testing/blocks";

// The test helper that asks the admin's real renderer what it draws (T141).

describe("testing/blocks (T141)", () => {
	const blocks = [
		form({
			fields: [
				textInput("name", "Ticket name"),
				numberInput("places", "Places"),
				repeater("rows", "Rows", [textInput("x", "X")]) as never,
			],
			submit: { label: "Save", actionId: "save" },
		}),
	];

	it("lists a form's fields and names the ones renderElement draws nothing for", () => {
		expect(formFields(blocks).map((f) => f.action_id)).toEqual(["name", "places", "rows"]);
		expect(undrawnFields(blocks).map((f) => f.type)).toEqual(["repeater"]);
	});

	it("renders the drawn fields' labels and inputs, and nothing for a repeater", () => {
		const html = renderBlocks(blocks);
		expect(html).toContain("Ticket name");
		expect(html).toContain("Places");
		expect(html).not.toContain("Rows");
		expect(html.match(/<input/g)?.length).toBe(2);
	});
});
