/**
 * In-memory storage with the semantics the hold and inventory modules rely on: EmDash's guarded
 * `updateIf` (`null` matches a missing field, ranges compare numbers or strings), `query` with
 * `in`/range filters, `orderBy`, and a `(created, id)` keyset cursor. Every method call is counted
 * in `meter.calls`, like a bridge call.
 */
type Doc = Record<string, unknown>;
type Range = { lt?: number | string; lte?: number | string; gt?: number | string; gte?: number | string };

export const meter = { calls: 0 };

function matches(doc: Doc, where: Record<string, unknown>): boolean {
	return Object.entries(where).every(([field, cond]) => {
		const value = doc[field];
		if (cond === null) return value === null || value === undefined;
		if (typeof cond === "object") {
			if ("in" in cond) return (cond as { in: unknown[] }).in.includes(value);
			const r = cond as Range;
			if (typeof value !== "number" && typeof value !== "string") return false;
			return (
				(r.lt === undefined || value < r.lt) &&
				(r.lte === undefined || value <= r.lte) &&
				(r.gt === undefined || value > r.gt) &&
				(r.gte === undefined || value >= r.gte)
			);
		}
		return value === cond;
	});
}

export class FakeCollection {
	readonly docs = new Map<string, Doc>();
	private order = new Map<string, number>();
	private seq = 0;
	/** Return true to make that call throw. */
	failOn: ((method: string, id: string, args: unknown) => boolean) | null = null;
	/** Runs just before an `updateIf` is applied (to land a racing write). */
	beforeUpdate: ((id: string, args: unknown) => void) | null = null;

	set(id: string, data: Doc) {
		if (!this.order.has(id)) this.order.set(id, this.seq++);
		this.docs.set(id, data);
	}

	async get(id: string) {
		meter.calls++;
		return this.docs.get(id) ?? null;
	}

	async query(options: {
		where?: Record<string, unknown>;
		orderBy?: Record<string, "asc" | "desc">;
		limit?: number;
		cursor?: string;
	}) {
		meter.calls++;
		const limit = Math.min(options.limit ?? 50, 100);
		let rows = [...this.docs.entries()].filter(([, d]) => matches(d, options.where ?? {}));
		const [field] = Object.keys(options.orderBy ?? {});
		rows.sort(([a, da], [b, db]) => {
			if (field) {
				const x = String(da[field] ?? "");
				const y = String(db[field] ?? "");
				if (x !== y) return x < y ? -1 : 1;
			}
			return (this.order.get(a) ?? 0) - (this.order.get(b) ?? 0);
		});
		if (options.cursor) {
			const at = rows.findIndex(([id]) => id === options.cursor);
			rows = at >= 0 ? rows.slice(at + 1) : rows.filter(([id]) => (this.order.get(id) ?? 0) > Number(options.cursor));
		}
		const page = rows.slice(0, limit);
		const hasMore = rows.length > limit;
		return {
			items: page.map(([id, data]) => ({ id, data })),
			hasMore,
			...(hasMore ? { cursor: page[page.length - 1]?.[0] } : {}),
		};
	}

	async put(id: string, data: Doc) {
		meter.calls++;
		if (this.failOn?.("put", id, data)) throw new Error("injected storage failure");
		this.set(id, structuredClone(data));
	}

	async putMany(items: Array<{ id: string; data: Doc }>) {
		meter.calls++;
		if (this.failOn?.("putMany", "", items)) throw new Error("injected storage failure");
		for (const { id, data } of items) this.set(id, structuredClone(data));
	}

	async updateIf(
		id: string,
		args: {
			where: Record<string, unknown>;
			set?: Record<string, unknown>;
			delta?: Record<string, { inc: number } | { dec: number }>;
		},
	) {
		meter.calls++;
		if (this.failOn?.("updateIf", id, args)) throw new Error("injected storage failure");
		this.beforeUpdate?.(id, args);
		const doc = this.docs.get(id);
		if (!doc || !matches(doc, args.where)) return { applied: false as const };
		const next: Doc = { ...doc, ...(args.set ?? {}) };
		for (const [f, d] of Object.entries(args.delta ?? {})) {
			const base = typeof doc[f] === "number" ? (doc[f] as number) : 0;
			next[f] = "inc" in d ? base + d.inc : base - d.dec;
		}
		this.docs.set(id, next);
		return { applied: true as const, data: next };
	}
}

export class FakeKv {
	readonly values = new Map<string, { value: unknown; revision: string }>();
	private rev = 0;

	async getVersioned<T>(key: string) {
		meter.calls++;
		const v = this.values.get(key);
		return v ? { value: structuredClone(v.value) as T, revision: v.revision } : null;
	}

	async compareAndSet(key: string, expected: string | null, value: unknown) {
		meter.calls++;
		const current = this.values.get(key)?.revision ?? null;
		if (current !== expected) return { applied: false };
		this.values.set(key, { value: structuredClone(value), revision: String(++this.rev) });
		return { applied: true };
	}
}

export class FakeCron {
	readonly tasks = new Map<string, { schedule: string; data?: Record<string, unknown> }>();
	async schedule(name: string, opts: { schedule: string; data?: Record<string, unknown> }) {
		meter.calls++;
		this.tasks.set(name, opts);
	}
}

export function makeStore() {
	return {
		bookings: new FakeCollection(),
		event_configs: new FakeCollection(),
		ticket_types: new FakeCollection(),
		occurrences: new FakeCollection(),
		attendees: new FakeCollection(),
		outbox: new FakeCollection(),
	};
}
