import type { PluginContext } from "emdash/plugin";
import { describe, expect, it } from "vitest";
import { type AuditEventDoc, extendAuditChain, initialAuditEvents, newPiiSalt } from "../src/domain/audit";
import { ENVELOPE_ROUTES } from "../src/routes/envelopes";

/**
 * T117 (Phase 1 review finding 14): `envelopes/resend` repairs a missing `envelope.sent`, but a decline
 * can land between resend's reads and its write. The race is replayed here in-process with an in-memory
 * store that lets the decline's writes happen exactly inside that window, which the sandbox host cannot
 * schedule deterministically.
 */

type Doc = Record<string, unknown>;

function collection(rows: Map<string, Doc>, hooks: { afterUpdateIf?: () => Promise<void> } = {}) {
	return {
		rows,
		get: async (id: string) => rows.get(id) ?? null,
		getMany: async (ids: string[]) => new Map(ids.filter((id) => rows.has(id)).map((id) => [id, rows.get(id)])),
		put: async (id: string, data: Doc) => void rows.set(id, data),
		putMany: async (items: Array<{ id: string; data: Doc }>) => {
			for (const i of items) rows.set(i.id, i.data);
		},
		compareAndSet: async (id: string, expected: string | null, data: Doc) => {
			if (expected === null && rows.has(id)) return { applied: false };
			rows.set(id, data);
			return { applied: true };
		},
		updateIf: async (id: string, args: { where: Doc; set?: Doc }) => {
			const row = rows.get(id);
			if (!row || Object.entries(args.where).some(([k, v]) => row[k] !== v)) return { applied: false };
			const data = { ...row, ...args.set };
			rows.set(id, data);
			await hooks.afterUpdateIf?.();
			return { applied: true, data };
		},
		query: async (o: { where?: Doc; orderBy?: Record<string, "asc" | "desc">; limit?: number }) => {
			let items = [...rows].map(([id, data]) => ({ id, data }));
			for (const [k, v] of Object.entries(o.where ?? {})) items = items.filter((i) => i.data[k] === v);
			const [key, dir] = Object.entries(o.orderBy ?? {})[0] ?? [];
			if (key) items.sort((a, b) => ((a.data[key] as number) - (b.data[key] as number)) * (dir === "desc" ? -1 : 1));
			return { items: items.slice(0, o.limit ?? 100) };
		},
	};
}

const AT = "2026-10-22T10:00:00.000Z";
const ID = "env-race";

async function scenario() {
	const salt = newPiiSalt();
	const envelope = {
		status: "sent",
		title: "Waiver",
		templateId: "t1",
		templateVersion: 1,
		delivery: "email",
		signer: { name: "Ada", email: "ada@example.com", as: "self" },
		signerIds: [`${ID}:s1`],
		docSha256: "d".repeat(64),
		expiresAt: "2026-11-22T10:00:00.000Z",
		createdAt: AT,
		updatedAt: AT,
		piiSalt: salt,
	};
	const audit = collection(new Map());
	// `send` wrote `envelope.created` but died before `envelope.sent` and the invitation.
	for (const e of await initialAuditEvents(ID, [{ type: "envelope.created", at: AT, actor: "admin" }], salt)) {
		audit.rows.set(e.id, e.data as unknown as Doc);
	}
	const envelopes = collection(new Map([[ID, envelope as Doc]]));
	// The decline lands right after resend has rotated the token (it read the envelope as `sent`).
	const decline = async () => {
		envelopes.rows.set(ID, { ...envelope, status: "declined" });
		const head = [...audit.rows.values()].at(-1) as unknown as AuditEventDoc;
		const events = await extendAuditChain(
			ID,
			head,
			[
				{ type: "signer.declined", at: AT, actor: "signer", data: { hasReason: false } },
				{ type: "envelope.declined", at: AT, actor: "system" },
			],
			salt,
		);
		for (const e of events) audit.rows.set(e.id, e.data as unknown as Doc);
	};
	const signers = collection(new Map([[`${ID}:s1`, { status: "pending", order: 1, name: "Ada", email: "a@x.test" }]]), {
		afterUpdateIf: decline,
	});
	const ctx = {
		storage: { envelopes, signers, audit_events: audit, outbox: collection(new Map()) },
		settings: { get: async () => null },
		site: { url: "https://site.test", name: "Site" },
	} as unknown as PluginContext;
	return { ctx, audit };
}

describe("T117 finding 14: resend and a racing decline", () => {
	it("a decline that lands inside resend's window leaves no envelope.sent after envelope.declined", async () => {
		const { ctx, audit } = await scenario();
		const handler = (ENVELOPE_ROUTES["envelopes/resend"] as { handler: (r: unknown, c: PluginContext) => unknown })
			.handler;
		await handler({ input: { id: ID } }, ctx);
		const types = [...audit.rows.values()]
			.map((e) => e as unknown as AuditEventDoc)
			.sort((a, b) => a.seq - b.seq)
			.map((e) => e.type);
		expect(types).toEqual(["envelope.created", "signer.declined", "envelope.declined"]);
	});
});
