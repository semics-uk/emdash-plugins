import { createRequire } from "node:module";
import { expect, test } from "@playwright/test";

// Spike S6 (EU-FR-01): a native UI plugin registers an `events-list` Portable Text block.

test("EU-FR-01 an entry whose body contains an events-list block renders the block component", async ({
	browser,
}) => {
	// No JavaScript: the block is rendered on the server by the plugin's Astro component.
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	const response = await page.goto("/whats-on");
	expect(response?.status()).toBe(200);
	const block = page.getByTestId("event-list");
	await expect(block).toBeVisible();
	await expect(block.getByRole("heading", { level: 2 })).toHaveText("Upcoming events");
	await expect(block.getByRole("listitem")).toHaveCount(3);
	await context.close();
});

test("EU-FR-01 the events-list editor configuration validates as Block Kit", async () => {
	// The runtime test host only loads the built sandboxed plugin, not native descriptors, so the
	// native plugin's block fields are checked with emdash's own Block Kit validator.
	const emdashRequire = createRequire(createRequire(import.meta.url).resolve("emdash"));
	const { validateBlocks } = emdashRequire("@emdash-cms/blocks/server") as {
		validateBlocks: (blocks: unknown[]) => { valid: boolean; errors: unknown[] };
	};
	const ui = (await import("@semics-tech/emdash-events/ui")) as {
		createPlugin: () => {
			admin?: { portableTextBlocks?: Array<{ type: string; fields?: unknown[] }> };
		};
	};
	const blocks = ui.createPlugin().admin?.portableTextBlocks ?? [];
	const eventsList = blocks.find((b) => b.type === "events-list");
	expect(eventsList).toBeDefined();
	expect(eventsList?.fields?.length).toBeGreaterThan(0);
	// T054: the events-booking block validates the same way.
	const booking = blocks.find((b) => b.type === "events-booking");
	expect(booking?.fields?.length).toBeGreaterThan(0);
	const bookingResult = validateBlocks([
		{ type: "form", fields: booking?.fields, submit: { label: "Insert", action_id: "insert" } },
	]);
	expect(bookingResult.valid).toBe(true);
	const result = validateBlocks([
		{
			type: "form",
			fields: eventsList?.fields,
			submit: { label: "Insert", action_id: "insert" },
		},
	]);
	expect(result.errors).toEqual([]);
	expect(result.valid).toBe(true);
	// The validator is not vacuous: an unknown element type is rejected.
	const bad = validateBlocks([
		{ type: "form", fields: [{ type: "nope", action_id: "x", label: "X" }], submit: { label: "Insert", action_id: "insert" } },
	]);
	expect(bad.valid).toBe(false);
});
