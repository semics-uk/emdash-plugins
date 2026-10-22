import { beforeEach, describe, expect, it } from "vitest";

import { handlePanel, type PanelDeps, type WaiverAvailability } from "../../src/admin/panel";
import { makeStore, meter } from "../domain/fake-storage";

// The waiver toggle on the "Tickets & booking" panel (EV-FR-12, T063). Required waivers are Pro: the
// Free edition (no `waivers` seam) and a Pro build without a pairing or licence show the setting as
// unavailable with a banner; Pro fills the seam and the toggle becomes editable.

const EVENT = "entry_1";
type Doc = Record<string, unknown>;

beforeEach(() => {
	meter.calls = 0;
});

function world(availability?: WaiverAvailability, signature: Doc = { required: false, mode: "each_attendee" }) {
	const storage = makeStore();
	storage.event_configs.set(EVENT, {
		status: "on_sale",
		capacity: 100,
		reserved: 0,
		sold: 0,
		currency: "GBP",
		questions: [],
		signature,
		waitlistEnabled: false,
		catalog: { ticketTypes: {}, occurrences: {} },
	});
	const seenSettings: Array<Record<string, unknown>> = [];
	const deps: PanelDeps = {
		storage: storage as unknown as PanelDeps["storage"],
		settings: {
			list: async () => {
				meter.calls++;
				return [{ key: "esignPairing", value: "esign1.cl_x.secret" }];
			},
		},
		content: { get: async () => null },
		newId: () => crypto.randomUUID(),
		...(availability
			? {
					waivers: async (settings: Record<string, unknown>) => {
						seenSettings.push(settings);
						return availability;
					},
				}
			: {}),
	};
	const config = () => storage.event_configs.docs.get(EVENT) as Doc;
	return { deps, config, seenSettings };
}

type Block = { type: string; [key: string]: unknown };
type Field = { action_id: string; type: string; initial_value?: unknown };

const load = (deps: PanelDeps) => handlePanel(deps, { type: "panel_load" }, EVENT);
const save = (deps: PanelDeps, values: Doc) =>
	handlePanel(deps, { type: "form_submit", action_id: "panel.save", values }, EVENT);
const fields = (blocks: Block[]) => (blocks.find((b) => b.type === "form")?.fields ?? []) as Field[];
const banners = (blocks: Block[]) => blocks.filter((b) => b.type === "banner");
const text = (v: unknown) => JSON.stringify(v);

describe("EV-FR-12 waiver toggle on the editor panel", () => {
	it("EV-FR-12 Free: the waiver toggle is disabled with a banner and a submitted value is ignored", async () => {
		const w = world();
		const res = await load(w.deps);
		expect(fields(res.blocks as Block[]).map((f) => f.action_id)).not.toContain("waiver_required");
		expect(text(banners(res.blocks as Block[]))).toMatch(/Pro/);
		await save(w.deps, { waiver_required: true, waiver_template: "tpl_1", capacity: 90 });
		expect(w.config()).toMatchObject({ capacity: 90, signature: { required: false } });
	});

	it("EV-FR-12 without pairing, the waiver toggle is disabled with a banner asking for the pairing string", async () => {
		const w = world({ available: false, reason: "pairing" });
		const res = await load(w.deps);
		expect(fields(res.blocks as Block[]).map((f) => f.action_id)).not.toContain("waiver_required");
		expect(text(banners(res.blocks as Block[]))).toMatch(/pairing string/i);
		// The seam sees the settings the panel read once (no extra bridge calls of its own).
		expect(w.seenSettings[0]).toMatchObject({ esignPairing: "esign1.cl_x.secret" });
	});

	it("EV-FR-12 without a licence, the waiver toggle is disabled with a banner about the licence", async () => {
		const w = world({ available: false, reason: "licence" }, { required: true, templateId: "tpl_1", mode: "buyer" });
		const res = await load(w.deps);
		expect(fields(res.blocks as Block[]).map((f) => f.action_id)).not.toContain("waiver_required");
		expect(text(banners(res.blocks as Block[]))).toMatch(/licence/i);
		await save(w.deps, { waiver_required: false, capacity: 90 });
		expect(w.config()).toMatchObject({ signature: { required: true, templateId: "tpl_1", mode: "buyer" } });
	});

	it("EV-FR-12 paired and licensed: the toggle, template and mode are editable and saved", async () => {
		const w = world({ available: true });
		const res = await load(w.deps);
		const f = fields(res.blocks as Block[]);
		expect(f.map((x) => x.action_id)).toEqual(
			expect.arrayContaining(["waiver_required", "waiver_template", "waiver_mode"]),
		);
		expect(banners(res.blocks as Block[])).toEqual([]);

		const saved = await save(w.deps, { waiver_required: true, waiver_template: "tpl_1", waiver_mode: "buyer" });
		expect(text(saved.blocks)).toContain("Saved");
		expect(w.config()).toMatchObject({ signature: { required: true, templateId: "tpl_1", mode: "buyer" } });
		const again = fields((await load(w.deps)).blocks as Block[]);
		expect(again.find((x) => x.action_id === "waiver_required")?.initial_value).toBe(true);
	});

	it("EV-FR-12 a required waiver needs a template", async () => {
		const w = world({ available: true });
		const res = await save(w.deps, { waiver_required: true, waiver_template: "" });
		expect(text(res.blocks)).toMatch(/template/i);
		expect(w.config()).toMatchObject({ signature: { required: false } });
		// The protocol's id64 grammar, so the intents Pro mints are never refused for their template.
		await save(w.deps, { waiver_required: true, waiver_template: "my waiver!" });
		expect(w.config()).toMatchObject({ signature: { required: false } });
	});

	it("R22 Pro panel load and save stay within the design target", async () => {
		const w = world({ available: true });
		meter.calls = 0;
		await load(w.deps);
		expect(meter.calls).toBeLessThanOrEqual(8);
		meter.calls = 0;
		await save(w.deps, { waiver_required: true, waiver_template: "tpl_1" });
		expect(meter.calls).toBeLessThanOrEqual(8);
	});
});

describe("SX-FR-07 catalogue refresh on the editor panel (T066)", () => {
	const TEMPLATES = [
		{ id: "tpl_climb", name: "Climbing waiver" },
		{ id: "tpl_swim", name: "Swim waiver" },
	];
	type Opt = { label: string; value: string };
	const field = (blocks: Block[], id: string) =>
		fields(blocks).find((f) => f.action_id === id) as (Field & { options?: Opt[] }) | undefined;
	const press = (deps: PanelDeps) =>
		handlePanel(deps, { type: "block_action", action_id: "panel.templates.refresh" }, EVENT);

	it("SX-FR-07 with a cached catalogue the template field is a select of the templates, keeping the saved one", async () => {
		const w = world(
			{ available: true, templates: TEMPLATES },
			{ required: true, mode: "buyer", templateId: "tpl_gone" },
		);
		const f = field((await load(w.deps)).blocks as Block[], "waiver_template");
		expect(f?.type).toBe("select");
		expect(f?.options?.map((o) => o.value)).toEqual(["tpl_climb", "tpl_swim", "tpl_gone"]);
		expect(f?.options?.[0]?.label).toBe("Climbing waiver");
		expect(f?.initial_value).toBe("tpl_gone");
		const saved = await save(w.deps, { waiver_required: true, waiver_template: "tpl_swim" });
		expect(text(saved.blocks)).toContain("Saved");
		expect(w.config()).toMatchObject({ signature: { required: true, templateId: "tpl_swim" } });
	});

	it("SX-FR-07 without a catalogue the field stays a text input, and there is no refresh button unless Pro offers one", async () => {
		const w = world({ available: true });
		const blocks = (await load(w.deps)).blocks as Block[];
		expect(field(blocks, "waiver_template")?.type).toBe("text_input");
		expect(text(blocks)).not.toContain("panel.templates.refresh");
	});

	it("SX-FR-07 Refresh templates asks the seam for a link to the suite page and shows it", async () => {
		const w = world({ available: true, refresh: async () => "https://site.test/_events/templates#catalog=tok.sig" });
		expect(text((await load(w.deps)).blocks)).toContain("panel.templates.refresh");
		const res = await press(w.deps);
		expect(text(res.blocks)).toContain("https://site.test/_events/templates#catalog=tok.sig");
		expect(text(res.blocks)).toContain('"kind":"external"');
	});

	it("SX-FR-07 Refresh without a minted link says so, and Free ignores the action", async () => {
		const none = world({ available: true, refresh: async () => null });
		expect(text((await press(none.deps)).blocks)).toMatch(/pairing|paste|could not/i);
		const free = world();
		expect(text((await press(free.deps)).blocks)).not.toContain("https://");
	});
});
