import { describe, expect, it } from "vitest";
import {
	canTransition,
	ENVELOPE_STATUSES,
	type EnvelopeStatus,
	isTerminal,
	TRANSITIONS,
	type TransitionStore,
	transitionEnvelope,
} from "../src/domain/state";

/** The only legal moves (ES-FR-03). Everything not listed here must be rejected. */
const LEGAL: ReadonlyArray<readonly [EnvelopeStatus, EnvelopeStatus]> = [
	["draft", "sent"],
	["draft", "voided"],
	["sent", "in_progress"],
	["sent", "completed"],
	["sent", "declined"],
	["sent", "voided"],
	["sent", "expired"],
	["in_progress", "completed"],
	["in_progress", "declined"],
	["in_progress", "voided"],
	["in_progress", "expired"],
];

const isLegal = (from: EnvelopeStatus, to: EnvelopeStatus) => LEGAL.some(([f, t]) => f === from && t === to);

const pairs = ENVELOPE_STATUSES.flatMap((from) => ENVELOPE_STATUSES.map((to) => [from, to] as const));

describe("ES-FR-03 envelope status machine", () => {
	it.each(pairs)("ES-FR-03 %s -> %s is legal only if listed", (from, to) => {
		expect(canTransition(from, to)).toBe(isLegal(from, to));
	});

	it("ES-FR-03 the TRANSITIONS table is exactly the legal list", () => {
		const fromTable = ENVELOPE_STATUSES.flatMap((from) => TRANSITIONS[from].map((to) => `${from}>${to}`)).sort();
		expect(fromTable).toEqual(LEGAL.map(([f, t]) => `${f}>${t}`).sort());
	});

	it("ES-FR-03 terminal statuses have no way out", () => {
		for (const s of ENVELOPE_STATUSES) {
			expect(isTerminal(s), s).toBe(["completed", "declined", "voided", "expired"].includes(s));
		}
	});

	it("ES-FR-03 unknown statuses are rejected", () => {
		expect(canTransition("weird", "sent")).toBe(false);
		expect(canTransition("draft", "weird")).toBe(false);
		expect(canTransition("toString", "sent")).toBe(false);
		expect(canTransition(undefined, "sent")).toBe(false);
	});
});

type Doc = { status: EnvelopeStatus; note?: string };

function memoryStore(initial: Doc | null) {
	let current = initial;
	const calls: unknown[] = [];
	const store: TransitionStore<Doc> = {
		async updateIf(_id, args) {
			calls.push(args);
			if (!current) return { applied: false };
			for (const [k, v] of Object.entries(args.where)) {
				if ((current as Record<string, unknown>)[k] !== v) return { applied: false };
			}
			current = { ...current, ...args.set };
			return { applied: true, data: current };
		},
	};
	return { store, calls, get: () => current };
}

describe("ES-FR-03 transitionEnvelope (shared by routes and cron)", () => {
	it("applies a legal transition as one guarded update on the expected status", async () => {
		const m = memoryStore({ status: "sent" });
		const r = await transitionEnvelope(m.store, "e1", "sent", "completed", { note: "x" });
		expect(r).toEqual({ ok: true, value: { status: "completed", note: "x" } });
		expect(m.calls).toEqual([{ where: { status: "sent" }, set: { note: "x", status: "completed" } }]);
	});

	it("rejects an illegal transition without touching storage", async () => {
		const m = memoryStore({ status: "completed" });
		expect(await transitionEnvelope(m.store, "e1", "completed", "sent")).toEqual({
			ok: false,
			error: "ILLEGAL_TRANSITION",
		});
		expect(m.calls).toHaveLength(0);
	});

	it("reports CONFLICT when the stored status moved on (lost race) or the row is missing", async () => {
		const m = memoryStore({ status: "voided" });
		expect(await transitionEnvelope(m.store, "e1", "sent", "completed")).toEqual({ ok: false, error: "CONFLICT" });
		expect(m.get()?.status).toBe("voided");
		expect(await transitionEnvelope(memoryStore(null).store, "e1", "sent", "completed")).toEqual({
			ok: false,
			error: "CONFLICT",
		});
	});

	it("a caller cannot smuggle a different status through `set`", async () => {
		const m = memoryStore({ status: "draft" });
		const r = await transitionEnvelope(m.store, "e1", "draft", "sent", { status: "completed" });
		expect(r.ok && r.value.status).toBe("sent");
	});
});
