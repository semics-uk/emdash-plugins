/**
 * Markdown template documents, versioning and archiving (ES-FR-01). Pure: no I/O, the id and the
 * clock are injected.
 *
 * Storage layout in the `templates` collection (only `status`, `kind` and `public` are indexed):
 *  - the head document, id = template id, status `active` | `archived`, holds the latest version;
 *  - one immutable version document per version, id `<id>:v<n>`, status `version`.
 * Editing writes a new version and bumps the head; envelopes freeze their own snapshot at send, so
 * an edit never changes a sent envelope.
 */
import { err, ok, type Result, templateFields } from "@semics-tech/shared";

export type TemplateStatus = "active" | "archived" | "version";

export interface TemplateDoc {
	name: string;
	description?: string;
	kind: "text";
	status: TemplateStatus;
	public: boolean;
	version: number;
	body: string;
	fields: string[];
	/** Present on version documents only. */
	templateId?: string;
	createdAt: string;
	updatedAt: string;
}

export type TemplateIssueCode =
	| "INVALID_INPUT"
	| "INVALID_NAME"
	| "INVALID_BODY"
	| "INVALID_DESCRIPTION"
	| "TEMPLATE_ARCHIVED";

export interface TemplateIssue {
	path: string;
	code: TemplateIssueCode;
}

export const MAX_NAME_LENGTH = 200;
export const MAX_DESCRIPTION_LENGTH = 1000;
/** Characters, not bytes: 100k characters is at most 400 KB, inside the 512 KiB document limit. */
export const MAX_BODY_LENGTH = 100_000;

export const versionDocId = (templateId: string, version: number): string => `${templateId}:v${version}`;

interface Fields {
	name: string;
	body: string;
	description?: string;
}

function validate(input: unknown): Result<Fields, TemplateIssue[]> {
	if (typeof input !== "object" || input === null || Array.isArray(input)) {
		return err([{ path: "", code: "INVALID_INPUT" }]);
	}
	const { name, body, description } = input as Record<string, unknown>;
	const issues: TemplateIssue[] = [];
	const trimmed = typeof name === "string" ? name.trim() : "";
	if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) issues.push({ path: "name", code: "INVALID_NAME" });
	if (typeof body !== "string" || body.trim().length === 0 || body.length > MAX_BODY_LENGTH) {
		issues.push({ path: "body", code: "INVALID_BODY" });
	}
	if (description !== undefined && (typeof description !== "string" || description.length > MAX_DESCRIPTION_LENGTH)) {
		issues.push({ path: "description", code: "INVALID_DESCRIPTION" });
	}
	if (issues.length > 0) return err(issues);
	return ok({
		name: trimmed,
		body: body as string,
		...(typeof description === "string" && description !== "" ? { description } : {}),
	});
}

function versionOf(head: TemplateDoc, templateId: string): TemplateDoc {
	return { ...head, status: "version", templateId };
}

export interface CreatedTemplate {
	head: TemplateDoc;
	versions: Array<{ id: string; data: TemplateDoc }>;
}

export function createTemplate(
	input: unknown,
	ctx: { id: string; now: string },
): Result<CreatedTemplate, TemplateIssue[]> {
	const v = validate(input);
	if (!v.ok) return v;
	const head: TemplateDoc = {
		name: v.value.name,
		...(v.value.description === undefined ? {} : { description: v.value.description }),
		kind: "text",
		status: "active",
		public: false,
		version: 1,
		body: v.value.body,
		fields: templateFields(v.value.body),
		createdAt: ctx.now,
		updatedAt: ctx.now,
	};
	return ok({ head, versions: [{ id: versionDocId(ctx.id, 1), data: versionOf(head, ctx.id) }] });
}

export interface UpdatedTemplate {
	head: TemplateDoc;
	version: { id: string; data: TemplateDoc };
}

export function updateTemplate(
	existing: TemplateDoc,
	input: unknown,
	ctx: { id: string; now: string },
): Result<UpdatedTemplate, TemplateIssue[]> {
	if (existing.status === "archived") return err([{ path: "", code: "TEMPLATE_ARCHIVED" }]);
	const v = validate(input);
	if (!v.ok) return v;
	const { description: _drop, ...rest } = existing;
	const head: TemplateDoc = {
		...rest,
		...(v.value.description === undefined ? {} : { description: v.value.description }),
		name: v.value.name,
		body: v.value.body,
		fields: templateFields(v.value.body),
		version: existing.version + 1,
		updatedAt: ctx.now,
	};
	return ok({ head, version: { id: versionDocId(ctx.id, head.version), data: versionOf(head, ctx.id) } });
}

export function archiveTemplate(head: TemplateDoc, now: string): TemplateDoc {
	return head.status === "archived" ? head : { ...head, status: "archived", updatedAt: now };
}

/** Archived templates look missing to the envelope flow, so they can't start new envelopes. */
export function usableForNewEnvelope(head: TemplateDoc): Result<TemplateDoc, "TEMPLATE_NOT_FOUND"> {
	return head.status === "active" ? ok(head) : err("TEMPLATE_NOT_FOUND");
}
