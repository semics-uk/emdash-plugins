import type { PluginContext } from "emdash/plugin";
import { describe, expect, it } from "vitest";

import type { WaiverAvailability, WaiverCheck } from "../../src/admin/panel";
import { adminRoute } from "../../src/routes/admin";
import { editorTicketsRoute } from "../../src/routes/editor";
import { makeStore } from "../domain/fake-storage";

// T142: the Event editor page (Events -> Edit, on the `admin` route) is the same "Tickets & booking"
// panel as the content entry's (`editor/tickets`). On LMSC staging (Pro and E-sign installed, not paired)
// the entry panel asked for the pairing string while the editor page said waivers need Events Pro: the
// admin route built the panel without the Pro `waivers` seam. Both routes now take the same seam.

const EVENT = "ev1";
type Block = { type: string; fields?: Array<{ action_id: string }>; [key: string]: unknown };
type Route = { handler: (routeCtx: unknown, ctx: PluginContext) => Promise<unknown> };

function ctxWith(): PluginContext {
	const storage = makeStore();
	storage.event_configs.set(EVENT, {
		status: "on_sale",
		capacity: 100,
		reserved: 0,
		sold: 0,
		currency: "GBP",
		questions: [],
		signature: { required: false, mode: "each_attendee" },
		waitlistEnabled: false,
		catalog: { ticketTypes: {}, occurrences: {} },
	});
	return {
		storage,
		settings: { list: async () => [{ key: "esignPairing", value: "" }] },
		schema: { listCollections: async () => [] },
		content: { get: async () => null, list: async () => ({ items: [] }) },
		plugin: { id: "semics-events" },
	} as unknown as PluginContext;
}

const seam =
	(availability: WaiverAvailability): ((ctx: PluginContext) => WaiverCheck) =>
	() =>
	async () =>
		availability;

async function editorPage(route: Route): Promise<Block[]> {
	const out = (await route.handler(
		{
			input: { type: "block_action", action_id: "events.edit", value: EVENT },
			request: { url: "https://site.test/_emdash/api/plugins/semics-events/admin" },
		},
		ctxWith(),
	)) as { blocks: Block[] };
	return out.blocks;
}

async function entryPanel(route: Route): Promise<Block[]> {
	const out = (await route.handler({ input: { type: "panel_load" }, ui: { entry: { id: EVENT } } }, ctxWith())) as {
		blocks: Block[];
	};
	return out.blocks;
}

const bannerText = (blocks: Block[]) => JSON.stringify(blocks.filter((b) => b.type === "banner"));
const fieldIds = (blocks: Block[]) =>
	blocks.filter((b) => b.type === "form").flatMap((b) => (b.fields ?? []).map((f) => f.action_id));

describe("T142 the Event editor page asks the same waivers seam as the entry panel", () => {
	it("EV-FR-12 with the seam reporting pairing, the editor page shows the pairing message, like the panel", async () => {
		const waivers = seam({ available: false, reason: "pairing" });
		const panel = await entryPanel(editorTicketsRoute({ waivers }) as Route);
		const page = await editorPage(adminRoute({ waivers }) as Route);
		expect(bannerText(panel)).toMatch(/pairing string/i);
		expect(bannerText(page)).toMatch(/pairing string/i);
		expect(bannerText(page)).not.toMatch(/need Events Pro/);
	});

	it("EV-FR-12 Free (no seam) shows the edition message on both", async () => {
		const panel = await entryPanel(editorTicketsRoute() as Route);
		const page = await editorPage(adminRoute() as Route);
		expect(bannerText(panel)).toMatch(/need Events Pro/);
		expect(bannerText(page)).toMatch(/need Events Pro/);
	});

	it("EV-FR-12 paired and licensed, the editor page offers the waiver template fields like the panel", async () => {
		const waivers = seam({ available: true });
		const panel = await entryPanel(editorTicketsRoute({ waivers }) as Route);
		const page = await editorPage(adminRoute({ waivers }) as Route);
		for (const blocks of [panel, page]) {
			expect(fieldIds(blocks)).toEqual(expect.arrayContaining(["waiver_required", "waiver_template", "waiver_mode"]));
			expect(bannerText(blocks)).toBe("[]");
		}
	});
});
