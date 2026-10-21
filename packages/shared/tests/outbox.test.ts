import { describe, expect, it } from "vitest";
import {
	drainOutbox,
	enqueueEmail,
	OUTBOX_COLLECTION,
	type OutboxEmail,
	type OutboxRecord,
	type OutboxStorage,
	outboxStatus,
} from "../src/outbox";

function memStorage() {
	const rows = new Map<string, OutboxRecord>();
	const calls: string[] = [];
	const storage: OutboxStorage = {
		async put(id, data) {
			calls.push("put");
			rows.set(id, data);
		},
		async putMany(items) {
			calls.push("putMany");
			for (const i of items) rows.set(i.id, i.data);
		},
		async query({ status, nextAttemptAtLte, limit }) {
			calls.push("query");
			const items = [...rows]
				.filter(
					([, r]) => r.status === status && (nextAttemptAtLte === undefined || r.nextAttemptAt <= nextAttemptAtLte),
				)
				.sort((a, b) => a[1].nextAttemptAt - b[1].nextAttemptAt)
				.slice(0, limit)
				.map(([id, data]) => ({ id, data }));
			return { items };
		},
	};
	return { storage, rows, calls };
}

function mail(sent: string[], failFor = new Set<string>()): OutboxEmail {
	return {
		async send(m) {
			sent.push(m.to);
			if (failFor.has(m.to)) throw new Error("smtp down");
		},
	};
}

const msg = (to: string) => ({ to, subject: "s", text: "t" });

describe("outbox", () => {
	it("uses the outbox collection with a status+nextAttemptAt index", () => {
		expect(OUTBOX_COLLECTION.name).toBe("outbox");
		expect(OUTBOX_COLLECTION.indexes).toContainEqual(["status", "nextAttemptAt"]);
	});

	it("sends queued mail once on the next cron run", async () => {
		const { storage } = memStorage();
		const sent: string[] = [];
		await enqueueEmail(storage, msg("a@x.com"), 1000, () => "m1");
		const r1 = await drainOutbox({ storage, email: mail(sent), now: 1000 });
		const r2 = await drainOutbox({ storage, email: mail(sent), now: 2000 });
		expect(sent).toEqual(["a@x.com"]);
		expect(r1.sent).toBe(1);
		expect(r2.sent).toBe(0);
	});

	it("retries a failing send with backoff and gives up after 5 attempts", async () => {
		const { storage, rows } = memStorage();
		const sent: string[] = [];
		const email = mail(sent, new Set(["bad@x.com"]));
		await enqueueEmail(storage, msg("bad@x.com"), 0, () => "m1");
		await drainOutbox({ storage, email, now: 0 });
		expect(rows.get("m1")?.attempts).toBe(1);
		expect(rows.get("m1")?.nextAttemptAt).toBeGreaterThanOrEqual(60_000);
		// too early: not retried
		await drainOutbox({ storage, email, now: 30_000 });
		expect(sent).toHaveLength(1);
		const delays: number[] = [];
		for (let i = 0; i < 6; i++) {
			const due = rows.get("m1")?.nextAttemptAt ?? 0;
			await drainOutbox({ storage, email, now: due });
			delays.push((rows.get("m1")?.nextAttemptAt ?? 0) - due);
		}
		expect(sent).toHaveLength(5);
		expect(rows.get("m1")?.status).toBe("failed");
		expect(rows.get("m1")?.lastError).toContain("smtp down");
		expect(delays[1]).toBeGreaterThan(delays[0] ?? 0);
		await drainOutbox({ storage, email, now: 10 ** 9 });
		expect(sent).toHaveLength(5);
	});

	it("keeps mail queued and reports no_transport without ctx.email", async () => {
		const { storage, rows, calls } = memStorage();
		await enqueueEmail(storage, msg("a@x.com"), 0, () => "m1");
		const before = calls.length;
		const r = await drainOutbox({ storage, email: undefined, now: 10 });
		expect(r.sent).toBe(0);
		expect(calls.length).toBe(before);
		expect(rows.get("m1")?.status).toBe("pending");
		expect(await outboxStatus({ storage, email: undefined, now: 10 })).toMatchObject({
			state: "no_transport",
			pending: 1,
		});
		expect(await outboxStatus({ storage, email: mail([]), now: 10 })).toMatchObject({
			state: "ok",
			pending: 1,
			failed: 0,
		});
	});

	it("stays within the call budget per tick", async () => {
		const { storage, rows, calls } = memStorage();
		for (let i = 0; i < 30; i++) await enqueueEmail(storage, msg(`u${i}@x.com`), 0, () => `m${i}`);
		calls.length = 0;
		const counted: OutboxEmail = {
			async send() {
				calls.push("send");
			},
		};
		const r = await drainOutbox({ storage, email: counted, now: 0 });
		expect(calls.length).toBeLessThanOrEqual(8);
		expect(r.remainingHint).toBe(true);
		const r2 = await drainOutbox({ storage, email: counted, now: 0, maxPerTick: 2 });
		expect(r2.sent).toBe(2);
		expect([...rows.values()].filter((x) => x.status === "sent")).toHaveLength(r.sent + 2);
	});
});
