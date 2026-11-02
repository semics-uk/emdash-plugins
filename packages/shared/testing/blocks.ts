/**
 * Test-only: what the admin's Block Kit renderer (`@emdash-cms/blocks`) actually draws (T141).
 *
 * The host validates a Block Kit response against a schema that accepts more than the renderer
 * draws: `FormBlockComponent` draws each field through `renderElement`, which returns null for a
 * `repeater` (and a `media_picker`). A panel whose tests only post form values to the route can
 * therefore pass while the admin shows nothing to type into. These helpers ask the real renderer.
 *
 * React and react-dom are resolved next to `@emdash-cms/blocks` (its peers), so a package gets them
 * without depending on React itself.
 */
import { createRequire } from "node:module";

import { BlockRenderer, renderElement } from "@emdash-cms/blocks";

const blocksEntry = createRequire(import.meta.url).resolve("@emdash-cms/blocks");
const nextToBlocks = createRequire(blocksEntry);
const { createElement } = nextToBlocks("react") as { createElement(type: unknown, props: unknown): unknown };
const { renderToStaticMarkup } = nextToBlocks("react-dom/server") as {
	renderToStaticMarkup(node: unknown): string;
};

type Field = { type: string; action_id?: string; label?: string; [key: string]: unknown };
type AnyBlock = { type: string; fields?: Field[]; [key: string]: unknown };

/** Every field of every form block, in order. */
export function formFields(blocks: ReadonlyArray<unknown>): Field[] {
	return (blocks as AnyBlock[]).filter((b) => b.type === "form").flatMap((b) => b.fields ?? []);
}

/** The form fields the renderer draws nothing for (`renderElement` returns null). */
export function undrawnFields(blocks: ReadonlyArray<unknown>): Field[] {
	const noop = () => {};
	return formFields(blocks).filter((f) => renderElement(f as never, noop, noop) === null);
}

/** The blocks as the admin renders them, as static HTML (no scripts run). */
export function renderBlocks(blocks: ReadonlyArray<unknown>): string {
	return renderToStaticMarkup(createElement(BlockRenderer as never, { blocks, onAction: () => {} }));
}
