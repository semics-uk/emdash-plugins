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
	describe("scrubbing (R32)", () => {
		const SECRET = "tok_SECRET-abc_123";
		const secretMsg = (to: string) => ({
			to,
			subject: "Sign",
			text: `link /sign/${SECRET}`,
			html: `<a href="/sign/${SECRET}">sign</a>`,
			payload: { token: SECRET },
		});

		it("a sent row keeps to/subject/timestamps/attempts and loses body, html and payload", async () => {
			const { storage, rows } = memStorage();
			await enqueueEmail(storage, secretMsg("a@x.com") as never, 1000, () => "m1");
			await drainOutbox({ storage, email: mail([]), now: 2000 });
			const row = rows.get("m1");
			expect(row).toMatchObject({ status: "sent", attempts: 1, createdAt: 1000, sentAt: 2000 });
			expect(row?.message).toEqual({ to: "a@x.com", subject: "Sign" });
			expect(JSON.stringify(row)).not.toContain(SECRET);
		});

		it("a row that gives up is scrubbed the same way and keeps lastError", async () => {
			const { storage, rows } = memStorage();
			const email = mail([], new Set(["bad@x.com"]));
			await enqueueEmail(storage, secretMsg("bad@x.com") as never, 0, () => "m1");
			for (let i = 0; i < 5; i++) await drainOutbox({ storage, email, now: rows.get("m1")?.nextAttemptAt ?? 0 });
			const row = rows.get("m1");
			expect(row).toMatchObject({ status: "failed", attempts: 5, lastError: "smtp down" });
			expect(row?.message).toEqual({ to: "bad@x.com", subject: "Sign" });
			expect(JSON.stringify(row)).not.toContain(SECRET);
		});

		it("a row that will retry keeps its body, since it still has to be sent", async () => {
			const { storage, rows } = memStorage();
			await enqueueEmail(storage, secretMsg("bad@x.com") as never, 0, () => "m1");
			await drainOutbox({ storage, email: mail([], new Set(["bad@x.com"])), now: 0 });
			expect(rows.get("m1")?.status).toBe("pending");
			expect(rows.get("m1")?.message).toMatchObject({ text: `link /sign/${SECRET}` });
		});

		it("scrubbing adds no storage call: still 1 query + sends + 1 putMany", async () => {
			const { storage, calls } = memStorage();
			for (let i = 0; i < 3; i++) await enqueueEmail(storage, secretMsg(`u${i}@x.com`) as never, 0, () => `m${i}`);
			calls.length = 0;
			await drainOutbox({ storage, email: mail([]), now: 0 });
			expect(calls).toEqual(["query", "putMany"]);
		});
	});
});

describe("outbox lastError (T100, T057 review F12)", () => {
	it("keeps no link, code or token from the provider's error text", async () => {
		const { storage, rows } = memStorage();
		const code = "Zx9_aB3-kLmN0pQrStUvWxYz0123456789abcdefGHI";
		const email: OutboxEmail = {
			async send() {
				throw new Error(`550 rejected body: open https://site.example/booking?ref=AB12&k=${code} now (id ${code})`);
			},
		};
		await enqueueEmail(storage, msg("a@x.com"), 0, () => "m1");
		await drainOutbox({ storage, email, now: 0 });
		const lastError = rows.get("m1")?.lastError ?? "";
		expect(lastError).toContain("550 rejected");
		expect(lastError).not.toContain(code);
		expect(lastError).not.toContain("site.example");
		expect(lastError).not.toContain("k=");
	});
});
