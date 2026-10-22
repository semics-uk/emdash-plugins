import { beforeEach, describe, expect, it } from "vitest";

import {
	eraseBookings,
	RETENTION_MORE_TASK,
	RETENTION_SCHEDULE,
	RETENTION_TASK,
	type RetentionDeps,
	type RetentionStorage,
	retentionDays,
	retentionTick,
} from "../../src/cron/retention";
import { FakeCron, FakeKv, makeStore, meter } from "../domain/fake-storage";

const DAY = 86_400_000;
const NOW = Date.parse("2027-11-01T03:00:00.000Z");
const at = (days: number) => new Date(NOW + days * DAY).toISOString();

beforeEach(() => {
	meter.calls = 0;
});

function world(days: unknown = 365) {
	const storage = makeStore();
	const kv = new FakeKv();
	const cron = new FakeCron();
	// e_old: event 400 days ago; e_new: 100 days ago; e_future: next month.
	storage.event_configs.set("e_old", {
		status: "closed",
		reserved: 5,
		sold: 5,
		info: { startsAt: at(-400), endsAt: at(-399) },
	});
	storage.event_configs.set("e_new", {
		status: "closed",
		reserved: 2,
		sold: 2,
		info: { startsAt: at(-100), endsAt: null },
	});
	storage.event_configs.set("e_future", {
		status: "on_sale",
		reserved: 3,
		sold: 3,
		info: { startsAt: at(30), endsAt: null },
	});
	const deps = (now: number, extra: Partial<RetentionDeps> = {}): RetentionDeps => ({
		storage: storage as unknown as RetentionStorage,
		kv,
		cron,
		settings: {
			list: async () => {
				meter.calls++;
				return [{ key: "retentionDays", value: days }];
			},
		},
		now,
		...extra,
	});
	return { storage, kv, cron, deps };
}

const booking = (eventId: string, n: number, extra: Record<string, unknown> = {}) => ({
	ref: `${eventId}-${n}`,
	eventId,
	status: "confirmed",
	email: `p${n}@example.com`,
	buyer: { name: `Person ${n}`, email: `p${n}@example.com` },
	lines: [{ ticketTypeId: "tt", qty: 2, unitPriceMinor: 500 }],
	totals: { subtotalMinor: 1000, discountMinor: 0, totalMinor: 1000, currency: "GBP" },
	answers: { diet: "vegan" },
	accessTokenHash: "h",
	redeemHash: "r",
	redeemExpiresAt: at(-399),
	ipHash: "ip",
	createdAt: at(-420 + n),
	...extra,
});
const attendee = (bookingId: string, n: number) => ({
	bookingId,
	eventId: "x",
	ticketTypeId: "tt",
	name: `Guest ${n}`,
	email: `g${n}@example.com`,
	code: `C${bookingId}${n}`,
	status: "valid",
});

/** Run ticks until the job is idle again; returns the reports. */
async function drain(w: ReturnType<typeof world>, startAt = NOW, max = 60) {
	const reports = [];
	for (let i = 0; i < max; i++) {
		const before = meter.calls;
		const report = await retentionTick(w.deps(startAt + i * 60_000));
		expect(report.calls).toBe(meter.calls - before);
		expect(report.calls, `tick ${i}`).toBeLessThanOrEqual(8);
		reports.push(report);
		if (report.idle) return reports;
	}
	throw new Error("retention never finished");
}

// biome-ignore lint/suspicious/noExplicitAny: test reads loose documents
type Doc = Record<string, any>;

describe("retention job (EV-FR-20, R22)", () => {
	it("is a recurring task with a follow-up one-shot", () => {
		expect(RETENTION_TASK).toBe("retention");
		expect(RETENTION_MORE_TASK).toBe("retention-more");
		expect(RETENTION_SCHEDULE.split(" ")).toHaveLength(5);
	});

	it("retentionDays reads the setting: default 365, minimum 30", () => {
		expect(retentionDays({})).toBe(365);
		expect(retentionDays({ retentionDays: 90 })).toBe(90);
		expect(retentionDays({ retentionDays: 3 })).toBe(30);
		expect(retentionDays({ retentionDays: "x" })).toBe(365);
	});

	it("EV-FR-20 data older than the period is purged; newer, live and unscheduled data is kept", async () => {
		const w = world();
		w.storage.bookings.set("old", booking("e_old", 1));
		w.storage.bookings.set("old_cancelled", booking("e_old", 2, { status: "cancelled" }));
		w.storage.bookings.set("recent", booking("e_new", 3, { createdAt: at(-120) }));
		w.storage.bookings.set("live", booking("e_future", 4, { createdAt: at(-420) }));
		w.storage.bookings.set("live_held", booking("e_future", 5, { status: "held", createdAt: at(-420) }));
		w.storage.attendees.set("old-1", attendee("old", 1));
		w.storage.attendees.set("recent-1", attendee("recent", 2));
		w.storage.attendees.set("live-1", attendee("live", 3));
		await drain(w);

		const old = w.storage.bookings.docs.get("old") as Doc;
		expect(old.buyer).toEqual({ name: "", email: "" });
		expect(old).toMatchObject({
			email: "",
			answers: {},
			ipHash: null,
			redeemHash: null,
			redeemExpiresAt: null,
			accessTokenHash: "",
		});
		expect(old.erasedAt).toBeTruthy();
		// Counts and aggregates survive.
		expect(old).toMatchObject({
			status: "confirmed",
			lines: [{ qty: 2 }],
			totals: { totalMinor: 1000 },
			ref: "e_old-1",
		});
		expect(w.storage.event_configs.docs.get("e_old")).toMatchObject({ reserved: 5, sold: 5 });
		expect(w.storage.bookings.docs.get("old_cancelled")?.erasedAt).toBeTruthy();
		expect(w.storage.attendees.docs.get("old-1")).toMatchObject({
			name: "",
			email: "",
			code: "Cold1",
			status: "valid",
		});

		for (const id of ["recent", "live", "live_held"]) {
			expect(w.storage.bookings.docs.get(id)?.erasedAt, id).toBeUndefined();
		}
		expect((w.storage.bookings.docs.get("recent") as Doc).buyer.name).toBe("Person 3");
		expect(w.storage.attendees.docs.get("recent-1")?.name).toBe("Guest 2");
		expect(w.storage.attendees.docs.get("live-1")?.email).toBe("g3@example.com");
	});

	it("the period is configurable", async () => {
		const w = world(60);
		w.storage.bookings.set("recent", booking("e_new", 3, { createdAt: at(-120) }));
		await drain(w);
		expect(w.storage.bookings.docs.get("recent")?.erasedAt).toBeTruthy();
	});

	it("R22 pages across ticks with a cursor, each tick within 8 calls, and finishes", async () => {
		const w = world();
		for (let n = 0; n < 35; n++) {
			w.storage.bookings.set(`b${n}`, booking("e_old", n));
			w.storage.attendees.set(`b${n}-1`, attendee(`b${n}`, n));
		}
		const reports = await drain(w);
		expect(reports.length).toBeGreaterThan(3);
		for (let n = 0; n < 35; n++) expect(w.storage.bookings.docs.get(`b${n}`)?.erasedAt).toBeTruthy();
		expect(w.cron.tasks.get(RETENTION_MORE_TASK)).toBeTruthy();
	});

	it("a booking with more attendees than one page resumes with a cursor and erases the booking last", async () => {
		const w = world();
		w.storage.bookings.set("big", booking("e_old", 1));
		for (let n = 0; n < 130; n++) w.storage.attendees.set(`big-${n}`, attendee("big", n));
		await drain(w);
		expect(w.storage.bookings.docs.get("big")?.erasedAt).toBeTruthy();
		expect([...w.storage.attendees.docs.values()].every((a) => a.name === "" && a.email === "")).toBe(true);
	});

	it("a second pass does not rescan erased bookings from the start (floor)", async () => {
		const w = world();
		for (let n = 0; n < 40; n++) w.storage.bookings.set(`b${n}`, booking("e_old", n));
		const first = await drain(w);
		const state = w.kv.values.get("cron:retention")?.value as Record<string, unknown>;
		expect(state.phase).toBeUndefined();
		expect(state.floor).toBeTruthy();
		const second = await drain(w, NOW + 2 * DAY);
		expect(second.length).toBeLessThan(first.length);
	});

	it("outbox rows that are sent or failed and older than the period are deleted; pending rows stay", async () => {
		const w = world();
		const row = (to: string, status: string, days: number, attempts = 1) => ({
			kind: "confirm",
			to,
			payload: {},
			attempts,
			nextAttemptAt: at(days),
			status,
		});
		w.storage.outbox.set("o1", row("a@example.com", "sent", -400));
		w.storage.outbox.set("o2", row("b@example.com", "failed", -400, 5));
		w.storage.outbox.set("o3", row("c@example.com", "pending", -400, 0));
		w.storage.outbox.set("o4", row("d@example.com", "sent", -5));
		await drain(w);
		expect([...w.storage.outbox.docs.keys()].sort()).toEqual(["o3", "o4"]);
	});

	it("T057 F6 ipHash is cleared once the reserve rate window has passed, long before the period", async () => {
		const w = world();
		const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();
		w.storage.bookings.set("fresh", booking("e_future", 1, { status: "held", createdAt: minutesAgo(5) }));
		w.storage.bookings.set("hour", booking("e_future", 2, { createdAt: minutesAgo(120) }));
		w.storage.bookings.set("day", booking("e_future", 3, { createdAt: at(-2) }));
		await drain(w);
		expect(w.storage.bookings.docs.get("fresh")?.ipHash).toBe("ip");
		expect(w.storage.bookings.docs.get("hour")?.ipHash).toBeNull();
		expect(w.storage.bookings.docs.get("day")?.ipHash).toBeNull();
		// Nothing else about those bookings changed.
		expect(w.storage.bookings.docs.get("day")).toMatchObject({ email: "p3@example.com", status: "confirmed" });
		// A later pass clears the booking that was fresh.
		await drain(w, NOW + 2 * 3_600_000);
		expect(w.storage.bookings.docs.get("fresh")?.ipHash).toBeNull();
	});

	it("a pass within a day of the last full one only does the cheap ip step", async () => {
		const w = world();
		await drain(w);
		const before = meter.calls;
		const reports = await drain(w, NOW + 3_600_000);
		expect(reports.length).toBeLessThanOrEqual(3);
		expect(meter.calls - before).toBeLessThan(16);
	});
});

describe("erase on request (EV-FR-20)", () => {
	it("removes personal fields but keeps counts, and refuses a live booking", async () => {
		const w = world();
		w.storage.bookings.set("a", booking("e_new", 1));
		w.storage.bookings.set("live", booking("e_future", 2));
		w.storage.attendees.set("a-1", attendee("a", 1));
		const sent = { kind: "confirm", to: "p1@example.com", attempts: 1, nextAttemptAt: at(-5), status: "sent" };
		w.storage.outbox.set("o1", { ...sent, payload: { bookingId: "a" } });
		w.storage.outbox.set("o2", { ...sent, payload: { bookingId: "x" }, status: "pending" });
		const items = [...w.storage.bookings.docs.entries()].map(([id, data]) => ({ id, data }));
		meter.calls = 0;
		const out = await eraseBookings(w.storage as unknown as RetentionStorage, items, NOW, { pages: 2 });
		expect(out).toMatchObject({ erased: 1, kept: 1, complete: true });
		expect(out.calls).toBe(meter.calls);
		expect(out.calls).toBeLessThanOrEqual(8);
		expect(w.storage.bookings.docs.get("a")).toMatchObject({
			email: "",
			buyer: { name: "", email: "" },
			ipHash: null,
			status: "confirmed",
			totals: { totalMinor: 1000 },
		});
		expect(w.storage.bookings.docs.get("live")?.erasedAt).toBeUndefined();
		expect(w.storage.attendees.docs.get("a-1")).toMatchObject({ name: "", email: "" });
		expect(w.storage.event_configs.docs.get("e_new")).toMatchObject({ reserved: 2, sold: 2 });
		expect([...w.storage.outbox.docs.keys()]).toEqual(["o2"]);
	});
});
