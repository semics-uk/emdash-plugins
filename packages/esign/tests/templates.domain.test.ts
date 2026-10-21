import { describe, expect, it } from "vitest";
import {
	archiveTemplate,
	createTemplate,
	updateTemplate,
	usableForNewEnvelope,
	versionDocId,
} from "../src/domain/templates";

const NOW = "2026-10-21T10:00:00.000Z";
const LATER = "2026-10-22T10:00:00.000Z";
const input = { name: "NDA", body: "Dear {{name}}, sign by {{date}}. Hi {{name}}." };

function created() {
	const r = createTemplate(input, { id: "tpl_1", now: NOW });
	if (!r.ok) throw new Error("create failed");
	return r.value;
}

describe("templates domain (ES-FR-01)", () => {
	it("create returns version 1, derives fields in first-seen order and stores version 1 as a snapshot", () => {
		const { head, versions } = created();
		expect(head).toMatchObject({ name: "NDA", version: 1, status: "active", kind: "text", public: false });
		expect(head.fields).toEqual(["name", "date"]);
		expect(versions).toEqual([
			{
				id: versionDocId("tpl_1", 1),
				data: expect.objectContaining({ status: "version", version: 1, templateId: "tpl_1", body: input.body }),
			},
		]);
	});

	it("update returns version 2 and the old body stays in version 1", () => {
		const first = created();
		const r = updateTemplate(first.head, { name: "NDA v2", body: "New {{party}}" }, { id: "tpl_1", now: LATER });
		if (!r.ok) throw new Error("update failed");
		expect(r.value.head).toMatchObject({
			version: 2,
			name: "NDA v2",
			fields: ["party"],
			createdAt: NOW,
			updatedAt: LATER,
		});
		expect(r.value.version).toMatchObject({
			id: "tpl_1:v2",
			data: { version: 2, body: "New {{party}}", status: "version" },
		});
		expect(first.versions[0]?.data.body).toBe(input.body);
	});

	it("rejects bad input with the path and a stable code", () => {
		const cases: Array<[unknown, string, string]> = [
			[null, "", "INVALID_INPUT"],
			[{ name: " ", body: "x" }, "name", "INVALID_NAME"],
			[{ name: "x".repeat(201), body: "x" }, "name", "INVALID_NAME"],
			[{ name: "a", body: "" }, "body", "INVALID_BODY"],
			[{ name: "a", body: 5 }, "body", "INVALID_BODY"],
			[{ name: "a", body: "x".repeat(100_001) }, "body", "INVALID_BODY"],
			[{ name: "a", body: "x", description: 3 }, "description", "INVALID_DESCRIPTION"],
			[{ name: "a", body: "x", description: "d".repeat(1001) }, "description", "INVALID_DESCRIPTION"],
		];
		for (const [bad, path, code] of cases) {
			const r = createTemplate(bad, { id: "t", now: NOW });
			expect(r).toEqual({ ok: false, error: [{ path, code }] });
		}
	});

	it("keeps an optional description and trims the name", () => {
		const r = createTemplate({ name: "  Lease ", body: "b", description: "A lease" }, { id: "t", now: NOW });
		expect(r.ok && r.value.head).toMatchObject({ name: "Lease", description: "A lease" });
	});

	it("archived templates cannot be used for new envelopes or edited, and archiving is idempotent", () => {
		const { head } = created();
		expect(usableForNewEnvelope(head)).toEqual({ ok: true, value: head });
		const archived = archiveTemplate(head, LATER);
		expect(archived).toMatchObject({ status: "archived", version: 1, updatedAt: LATER });
		expect(usableForNewEnvelope(archived)).toEqual({ ok: false, error: "TEMPLATE_NOT_FOUND" });
		expect(archiveTemplate(archived, "2027-01-01T00:00:00.000Z")).toEqual(archived);
		expect(updateTemplate(archived, input, { id: "tpl_1", now: LATER })).toEqual({
			ok: false,
			error: [{ path: "", code: "TEMPLATE_ARCHIVED" }],
		});
	});

	it("update validates the same way as create", () => {
		const r = updateTemplate(created().head, { name: "", body: "x" }, { id: "tpl_1", now: LATER });
		expect(r).toEqual({ ok: false, error: [{ path: "name", code: "INVALID_NAME" }] });
	});
});
