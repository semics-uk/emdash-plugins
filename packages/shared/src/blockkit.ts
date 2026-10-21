/**
 * Typed Block Kit builders for the plugin admin UIs. Pure functions that return the host's JSON
 * shapes (snake_case keys) so admin code never hand-writes raw block JSON. The types are the
 * host's own (`import type` is erased, so nothing from `@emdash-cms/blocks` reaches a bundle).
 */
import type {
	AccordionBlock,
	ActionElement,
	ActionsBlock,
	BannerBlock,
	Block,
	ButtonElement,
	ChartBlock,
	ChartSeries,
	CheckboxElement,
	CodeBlock,
	ColumnsBlock,
	ComboboxElement,
	ConfirmDialog,
	ContextBlock,
	DateInputElement,
	DividerBlock,
	EmptyBlock,
	FieldsBlock,
	FormBlock,
	FormField,
	HeaderBlock,
	ImageBlock,
	LinkElement,
	LinkTarget,
	MediaPickerElement,
	MenuElement,
	MeterBlock,
	NumberInputElement,
	RadioElement,
	RepeaterElement,
	RepeaterSubField,
	SecretInputElement,
	SectionBlock,
	SelectElement,
	StatItem,
	StatsBlock,
	TabBlock,
	TabPanel,
	TableBlock,
	TableColumn,
	TextInputElement,
	ToggleElement,
} from "@emdash-cms/blocks";

export type {
	ActionElement,
	Block,
	FormField,
	LinkTarget,
	RepeaterSubField,
	StatItem,
	TabPanel,
	TableColumn,
};

type Option = { label: string; value: string };

/** Drop `undefined` entries so output is plain JSON the host validator accepts. */
function clean<T extends object>(value: T): T {
	for (const key of Object.keys(value) as Array<keyof T>) {
		if (value[key] === undefined) delete value[key];
	}
	return value;
}

// Layout and text blocks

export function header(text: string, opts: { blockId?: string } = {}): HeaderBlock {
	return clean({ type: "header", text, block_id: opts.blockId });
}

export function section(
	text: string,
	opts: { accessory?: ActionElement; blockId?: string } = {},
): SectionBlock {
	return clean({ type: "section", text, accessory: opts.accessory, block_id: opts.blockId });
}

export function divider(opts: { blockId?: string } = {}): DividerBlock {
	return clean({ type: "divider", block_id: opts.blockId });
}

export function context(text: string, opts: { blockId?: string } = {}): ContextBlock {
	return clean({ type: "context", text, block_id: opts.blockId });
}

export function fieldsBlock(
	fields: Array<{ label: string; value: string }>,
	opts: { blockId?: string } = {},
): FieldsBlock {
	return clean({ type: "fields", fields, block_id: opts.blockId });
}

export function image(opts: {
	url: string;
	alt: string;
	title?: string;
	blockId?: string;
}): ImageBlock {
	return clean({
		type: "image",
		url: opts.url,
		alt: opts.alt,
		title: opts.title,
		block_id: opts.blockId,
	});
}

export function columns(cols: Block[][], opts: { blockId?: string } = {}): ColumnsBlock {
	return clean({ type: "columns", columns: cols, block_id: opts.blockId });
}

export function tabs(
	panels: TabPanel[],
	opts: { defaultTab?: number; blockId?: string } = {},
): TabBlock {
	return clean({
		type: "tab",
		panels,
		default_tab: opts.defaultTab,
		block_id: opts.blockId,
	});
}

export function accordion(opts: {
	label: string;
	blocks: Block[];
	defaultOpen?: boolean;
	blockId?: string;
}): AccordionBlock {
	return clean({
		type: "accordion",
		label: opts.label,
		blocks: opts.blocks,
		default_open: opts.defaultOpen,
		block_id: opts.blockId,
	});
}

export function empty(opts: {
	title: string;
	description?: string;
	commandLine?: string;
	size?: "sm" | "base" | "lg";
	actions?: ActionElement[];
	blockId?: string;
}): EmptyBlock {
	return clean({
		type: "empty",
		title: opts.title,
		description: opts.description,
		command_line: opts.commandLine,
		size: opts.size,
		actions: opts.actions,
		block_id: opts.blockId,
	});
}

// Data blocks

export function stats(items: StatItem[], opts: { blockId?: string } = {}): StatsBlock {
	return clean({ type: "stats", items, block_id: opts.blockId });
}

export function table(opts: {
	columns: TableColumn[];
	rows: Array<Record<string, unknown>>;
	pageActionId: string;
	nextCursor?: string;
	emptyText?: string;
	blockId?: string;
}): TableBlock {
	return clean({
		type: "table",
		columns: opts.columns,
		rows: opts.rows,
		page_action_id: opts.pageActionId,
		next_cursor: opts.nextCursor,
		empty_text: opts.emptyText,
		block_id: opts.blockId,
	});
}

export function meter(opts: {
	label: string;
	value: number;
	max?: number;
	min?: number;
	customValue?: string;
	blockId?: string;
}): MeterBlock {
	return clean({
		type: "meter",
		label: opts.label,
		value: opts.value,
		max: opts.max,
		min: opts.min,
		custom_value: opts.customValue,
		block_id: opts.blockId,
	});
}

export function code(opts: {
	code: string;
	language?: "ts" | "tsx" | "jsonc" | "bash" | "css";
	blockId?: string;
}): CodeBlock {
	return clean({
		type: "code",
		code: opts.code,
		language: opts.language,
		block_id: opts.blockId,
	});
}

// Charts

export function timeseriesChart(opts: {
	series: ChartSeries[];
	style?: "line" | "bar";
	xAxisName?: string;
	yAxisName?: string;
	height?: number;
	gradient?: boolean;
	blockId?: string;
}): ChartBlock {
	return clean({
		type: "chart",
		config: clean({
			chart_type: "timeseries" as const,
			series: opts.series,
			style: opts.style,
			x_axis_name: opts.xAxisName,
			y_axis_name: opts.yAxisName,
			height: opts.height,
			gradient: opts.gradient,
		}),
		block_id: opts.blockId,
	});
}

export function customChart(opts: {
	options: Record<string, unknown>;
	height?: number;
	blockId?: string;
}): ChartBlock {
	return clean({
		type: "chart",
		config: clean({
			chart_type: "custom" as const,
			options: opts.options,
			height: opts.height,
		}),
		block_id: opts.blockId,
	});
}

/** Pie chart via the host's custom ECharts passthrough. */
export function pieChart(opts: {
	slices: Array<{ name: string; value: number }>;
	height?: number;
	blockId?: string;
}): ChartBlock {
	return customChart({
		options: { series: [{ type: "pie", data: opts.slices.map((s) => ({ ...s })) }] },
		height: opts.height,
		blockId: opts.blockId,
	});
}

// Banners and notices

export type NoticeSeverity = "error" | "warning" | "info";

/** The shape admin status checks return (e.g. `encryptionKeyStatus`, `validateMapping`). */
export interface NoticeInput {
	severity: NoticeSeverity;
	title: string;
	message?: string;
	blockId?: string;
}

const VARIANT: Record<NoticeSeverity, "default" | "alert" | "error"> = {
	error: "error",
	warning: "alert",
	info: "default",
};

/** Banner with the host's own variants: `default` (info), `alert` (warning) or `error`. */
export function banner(opts: {
	title?: string;
	description?: string;
	variant?: "default" | "alert" | "error";
	blockId?: string;
}): BannerBlock {
	if (opts.title === undefined && opts.description === undefined) {
		throw new Error("banner needs a title or a description");
	}
	return clean({
		type: "banner",
		title: opts.title,
		description: opts.description,
		variant: opts.variant,
		block_id: opts.blockId,
	});
}

/** Banner from `{ severity, title, message }`. `message` becomes the description. */
export function notice(input: NoticeInput): BannerBlock {
	return banner({
		title: input.title,
		description: input.message,
		variant: VARIANT[input.severity],
		blockId: input.blockId,
	});
}

/** One banner per notice, in order. Falsy entries are skipped so callers can inline checks. */
export function notices(
	items: ReadonlyArray<NoticeInput | null | undefined | false>,
): BannerBlock[] {
	return items.filter((n): n is NoticeInput => !!n).map(notice);
}

// Actions and elements

export function actions(elements: ActionElement[], opts: { blockId?: string } = {}): ActionsBlock {
	return clean({ type: "actions", elements, block_id: opts.blockId });
}

export function button(
	actionId: string,
	label: string,
	opts: { style?: "primary" | "danger" | "secondary"; value?: unknown; confirm?: ConfirmDialog } = {},
): ButtonElement {
	return clean({
		type: "button",
		action_id: actionId,
		label,
		style: opts.style,
		value: opts.value,
		confirm: opts.confirm,
	});
}

export function link(
	label: string,
	target: LinkTarget,
	opts: { appearance?: LinkElement["appearance"] } = {},
): LinkElement {
	return clean({ type: "link", label, target, appearance: opts.appearance });
}

export function menu(
	actionId: string,
	label: string,
	items: Option[],
	opts: { style?: MenuElement["style"] } = {},
): MenuElement {
	return clean({ type: "menu", action_id: actionId, label, items, style: opts.style });
}

// Form fields

export function textInput(
	actionId: string,
	label: string,
	opts: { placeholder?: string; initialValue?: string; multiline?: boolean } = {},
): TextInputElement {
	return clean({
		type: "text_input",
		action_id: actionId,
		label,
		placeholder: opts.placeholder,
		initial_value: opts.initialValue,
		multiline: opts.multiline,
	});
}

export function numberInput(
	actionId: string,
	label: string,
	opts: { initialValue?: number; min?: number; max?: number } = {},
): NumberInputElement {
	return clean({
		type: "number_input",
		action_id: actionId,
		label,
		initial_value: opts.initialValue,
		min: opts.min,
		max: opts.max,
	});
}

export function select(
	actionId: string,
	label: string,
	options: Option[],
	opts: { initialValue?: string; optionsRoute?: string } = {},
): SelectElement {
	return clean({
		type: "select",
		action_id: actionId,
		label,
		options,
		initial_value: opts.initialValue,
		optionsRoute: opts.optionsRoute,
	});
}

export function toggle(
	actionId: string,
	label: string,
	opts: { description?: string; initialValue?: boolean } = {},
): ToggleElement {
	return clean({
		type: "toggle",
		action_id: actionId,
		label,
		description: opts.description,
		initial_value: opts.initialValue,
	});
}

export function secretInput(
	actionId: string,
	label: string,
	opts: { placeholder?: string; hasValue?: boolean } = {},
): SecretInputElement {
	return clean({
		type: "secret_input",
		action_id: actionId,
		label,
		placeholder: opts.placeholder,
		has_value: opts.hasValue,
	});
}

export function checkbox(
	actionId: string,
	label: string,
	options: Option[],
	opts: { initialValue?: string[] } = {},
): CheckboxElement {
	return clean({
		type: "checkbox",
		action_id: actionId,
		label,
		options,
		initial_value: opts.initialValue,
	});
}

export function radio(
	actionId: string,
	label: string,
	options: Option[],
	opts: { initialValue?: string } = {},
): RadioElement {
	return clean({
		type: "radio",
		action_id: actionId,
		label,
		options,
		initial_value: opts.initialValue,
	});
}

export function combobox(
	actionId: string,
	label: string,
	options: Option[],
	opts: { initialValue?: string; placeholder?: string } = {},
): ComboboxElement {
	return clean({
		type: "combobox",
		action_id: actionId,
		label,
		options,
		initial_value: opts.initialValue,
		placeholder: opts.placeholder,
	});
}

export function dateInput(
	actionId: string,
	label: string,
	opts: { initialValue?: string; placeholder?: string } = {},
): DateInputElement {
	return clean({
		type: "date_input",
		action_id: actionId,
		label,
		initial_value: opts.initialValue,
		placeholder: opts.placeholder,
	});
}

/** Array-of-records field. Sub-fields are limited to text, number, select and toggle inputs. */
export function repeater(
	actionId: string,
	label: string,
	fields: RepeaterSubField[],
	opts: {
		itemLabel?: string;
		minItems?: number;
		maxItems?: number;
		initialValue?: Array<Record<string, unknown>>;
	} = {},
): RepeaterElement {
	return clean({
		type: "repeater",
		action_id: actionId,
		label,
		item_label: opts.itemLabel,
		fields,
		min_items: opts.minItems,
		max_items: opts.maxItems,
		initial_value: opts.initialValue,
	});
}

export function mediaPicker(
	actionId: string,
	label: string,
	opts: { mimeTypeFilter?: string; initialValue?: string; placeholder?: string } = {},
): MediaPickerElement {
	return clean({
		type: "media_picker",
		action_id: actionId,
		label,
		mime_type_filter: opts.mimeTypeFilter,
		initial_value: opts.initialValue,
		placeholder: opts.placeholder,
	});
}

/** Show a form field only while another field equals (or differs from) a value. Client-side. */
export function when<T extends FormField>(
	field: T,
	condition: { field: string; eq: unknown } | { field: string; neq: unknown },
): T {
	return { ...field, condition } as T;
}

export function form(opts: {
	fields: FormField[];
	submit: { label: string; actionId: string };
	blockId?: string;
}): FormBlock {
	return clean({
		type: "form",
		fields: opts.fields,
		submit: { label: opts.submit.label, action_id: opts.submit.actionId },
		block_id: opts.blockId,
	});
}
