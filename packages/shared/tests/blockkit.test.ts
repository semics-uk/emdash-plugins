import { validateBlocks } from "@emdash-cms/blocks/server";
import { describe, expect, it } from "vitest";
import * as bk from "../src/blockkit";

const policy = { pluginPagePaths: ["/events"] };

function expectValid(blocks: unknown[]): void {
	const result = validateBlocks(blocks, policy);
	expect(result.errors).toEqual([]);
	expect(result.valid).toBe(true);
}

describe("blockkit builders pass the host validator", () => {
	it("text and layout blocks", () => {
		expectValid([
			bk.header("Events", { blockId: "h" }),
			bk.section("Hello", { accessory: bk.button("go", "Go", { style: "primary" }) }),
			bk.divider(),
			bk.context("Muted"),
			bk.fieldsBlock([{ label: "Status", value: "Active" }]),
			bk.image({ url: "/media/a.png", alt: "A", title: "T" }),
			bk.columns([[bk.header("L")], [bk.context("R")]]),
			bk.accordion({ label: "More", blocks: [bk.context("x")], defaultOpen: true }),
			bk.empty({ title: "Nothing", description: "d", actions: [bk.button("add", "Add")] }),
		]);
	});

	it("data blocks", () => {
		expectValid([
			bk.stats([{ label: "Total", value: 12, trend: "up", description: "+2" }]),
			bk.table({
				columns: [
					{ key: "name", label: "Name", sortable: true },
					{ key: "act", label: "", format: "element" },
				],
				rows: [{ name: "A", act: bk.link("Open", { kind: "plugin-page", path: "/events" }) }],
				pageActionId: "page",
				nextCursor: "c",
				emptyText: "none",
			}),
			bk.meter({ label: "Quota", value: 5, max: 10, customValue: "5/10" }),
			bk.code({ code: "x", language: "bash" }),
		]);
	});

	it("charts", () => {
		expectValid([
			bk.timeseriesChart({
				series: [{ name: "Sales", data: [[1, 2]], color: "#086FFF" }],
				style: "bar",
				gradient: true,
				height: 200,
				xAxisName: "t",
				yAxisName: "n",
			}),
			bk.pieChart({ slices: [{ name: "A", value: 1 }], height: 200 }),
			bk.customChart({ options: { series: [] } }),
		]);
	});

	it("banners and notices", () => {
		expectValid([
			bk.banner({ title: "T" }),
			bk.banner({ description: "D", variant: "alert" }),
			...(["error", "warning", "info"] as const).map((severity) =>
				bk.notice({ severity, title: "Title", message: "Message" }),
			),
		]);
	});

	it("tabs", () => {
		expectValid([
			bk.tabs(
				[
					{ label: "A", blocks: [bk.context("a")] },
					{ label: "B", blocks: [bk.context("b")] },
				],
				{ defaultTab: 1 },
			),
		]);
	});

	it("forms with every field, conditions, menus and links", () => {
		expectValid([
			bk.form({
				blockId: "settings",
				fields: [
					bk.textInput("a", "A", { placeholder: "p", initialValue: "v", multiline: true }),
					bk.numberInput("b", "B", { initialValue: 1, min: 0, max: 5 }),
					bk.select("c", "C", [{ label: "x", value: "x" }], { initialValue: "x" }),
					bk.toggle("d", "D", { description: "d", initialValue: true }),
					bk.secretInput("e", "E", { hasValue: true }),
					bk.checkbox("f", "F", [{ label: "x", value: "x" }], { initialValue: ["x"] }),
					bk.radio("g", "G", [{ label: "x", value: "x" }], { initialValue: "x" }),
					bk.combobox("h", "H", [{ label: "x", value: "x" }], { placeholder: "p" }),
					bk.dateInput("i", "I", { initialValue: "2026-01-01" }),
					bk.when(bk.secretInput("j", "J"), { field: "d", eq: true }),
					bk.when(bk.textInput("k", "K"), { field: "d", neq: true }),
				],
				submit: { label: "Save", actionId: "save" },
			}),
			bk.actions([
				bk.menu("m", "More", [{ label: "x", value: "x" }], { style: "secondary" }),
				bk.link("Docs", { kind: "external", url: "https://example.com" }, { appearance: "inline" }),
				bk.button("del", "Delete", {
					style: "danger",
					value: 1,
					confirm: { title: "Sure?", text: "t", confirm: "Yes", deny: "No", style: "danger" },
				}),
			]),
		]);
	});

	it("repeater and media picker elements", () => {
		const repeater = bk.repeater(
			"types",
			"Ticket types",
			[bk.textInput("name", "Name"), bk.numberInput("price", "Price"), bk.toggle("on", "On")],
			{ itemLabel: "Ticket type", minItems: 1, maxItems: 5, initialValue: [{ name: "GA" }] },
		);
		const picker = bk.mediaPicker("hero", "Hero", { mimeTypeFilter: "image/" });
		expect(repeater).toMatchObject({ type: "repeater", item_label: "Ticket type", min_items: 1 });
		expect(picker).toEqual({
			type: "media_picker",
			action_id: "hero",
			label: "Hero",
			mime_type_filter: "image/",
		});
	});
});

describe("builder output shape", () => {
	it("omits undefined keys and uses snake_case", () => {
		expect(bk.header("x")).toEqual({ type: "header", text: "x" });
		expect(Object.keys(bk.table({ columns: [], rows: [], pageActionId: "p" }))).toEqual([
			"type",
			"columns",
			"rows",
			"page_action_id",
		]);
	});

	it("maps notice severities onto host banner variants", () => {
		expect(bk.notice({ severity: "error", title: "Bad", message: "Fix it" })).toEqual({
			type: "banner",
			title: "Bad",
			description: "Fix it",
			variant: "error",
		});
		expect(bk.notice({ severity: "warning", title: "w" }).variant).toBe("alert");
		expect(bk.notice({ severity: "info", title: "i" }).variant).toBe("default");
	});

	it("notices() skips falsy entries and keeps order", () => {
		const out = bk.notices([
			{ severity: "info", title: "a" },
			null,
			undefined,
			false,
			{ severity: "error", title: "b" },
		]);
		expect(out.map((b) => b.title)).toEqual(["a", "b"]);
	});

	it("banner needs a title or description", () => {
		expect(() => bk.banner({})).toThrow(/title or a description/);
	});
});

describe("sample admin page snapshots", () => {
	const page = {
		stats: bk.stats([{ label: "Events", value: 3 }]),
		table: bk.table({
			columns: [{ key: "t", label: "Title" }],
			rows: [{ t: "A" }],
			pageActionId: "p",
		}),
		form: bk.form({
			fields: [bk.textInput("a", "A"), bk.when(bk.toggle("b", "B"), { field: "a", eq: "x" })],
			submit: { label: "Save", actionId: "save" },
		}),
		repeater: bk.repeater("r", "R", [bk.textInput("q", "Q")], { itemLabel: "Q" }),
		banner: bk.notice({ severity: "warning", title: "Key missing", message: "Set it." }),
		tabs: bk.tabs([{ label: "One", blocks: [bk.context("c")] }]),
		chart: bk.timeseriesChart({ series: [{ name: "S", data: [[1, 2]] }] }),
	};
	it.each(Object.entries(page))("%s", (_name, block) => {
		expect(block).toMatchSnapshot();
	});
});
