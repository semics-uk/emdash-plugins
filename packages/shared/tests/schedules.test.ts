import { describe, expect, it } from "vitest";
import {
	ENSURE_SCHEDULES_TASK,
	ensureSchedules,
	runEnsureSchedulesJob,
	SCHEDULES_FLAG,
	type ScheduleCtx,
	scheduleRecurring,
} from "../src/schedules";

// T116 (R37): cores self-schedule their recurring crons because EmDash 1.2 never runs
// `plugin:activate` for config-declared sandboxed plugins.

function fakeCtx(opts: { flag?: unknown; failGet?: boolean; failSchedule?: boolean; noCron?: boolean } = {}) {
	const kv = new Map<string, unknown>();
	if (opts.flag !== undefined) kv.set(SCHEDULES_FLAG, opts.flag);
	const log: string[] = [];
	const scheduled: Array<{ name: string; schedule: string }> = [];
	const ctx: ScheduleCtx = {
		kv: {
			async get(key) {
				log.push(`kv.get ${key}`);
				if (opts.failGet) throw new Error("kv down");
				return kv.get(key) ?? null;
			},
			async set(key, value) {
				log.push(`kv.set ${key}`);
				kv.set(key, value);
			},
		},
		...(opts.noCron
			? {}
			: {
					cron: {
						async schedule(name, o) {
							log.push(`cron.schedule ${name}`);
							if (opts.failSchedule) throw new Error("cron down");
							scheduled.push({ name, schedule: o.schedule });
						},
					},
				}),
	};
	return { ctx, kv, log, scheduled };
}

const TASKS = [
	{ name: "sweep-holds", schedule: "*/5 * * * *" },
	{ name: "outbox-drain", schedule: "* * * * *" },
] as const;
const NOW = Date.parse("2026-10-22T10:00:00.000Z");

describe("ensureSchedules (route/hook check)", () => {
	it("when the flag is missing, queues one ensure task due now (2 calls) and schedules nothing else", async () => {
		const { ctx, log, scheduled } = fakeCtx();
		await ensureSchedules(ctx, NOW);
		expect(log).toEqual([`kv.get ${SCHEDULES_FLAG}`, `cron.schedule ${ENSURE_SCHEDULES_TASK}`]);
		expect(scheduled).toEqual([{ name: ENSURE_SCHEDULES_TASK, schedule: "2026-10-22T10:00:00.000Z" }]);
	});

	it("when the flag is set, makes only the one KV read", async () => {
		const { ctx, log, scheduled } = fakeCtx({ flag: { at: "x" } });
		await ensureSchedules(ctx, NOW);
		expect(log).toEqual([`kv.get ${SCHEDULES_FLAG}`]);
		expect(scheduled).toEqual([]);
	});

	it("never fails the caller: a KV or cron error is swallowed", async () => {
		await expect(ensureSchedules(fakeCtx({ failGet: true }).ctx, NOW)).resolves.toBeUndefined();
		await expect(ensureSchedules(fakeCtx({ failSchedule: true }).ctx, NOW)).resolves.toBeUndefined();
		await expect(ensureSchedules(fakeCtx({ noCron: true }).ctx, NOW)).resolves.toBeUndefined();
	});
});

describe("scheduleRecurring and the ensure job", () => {
	it("schedules every task, then sets the flag", async () => {
		const { ctx, kv, log, scheduled } = fakeCtx();
		await scheduleRecurring(ctx, TASKS, NOW);
		expect(scheduled).toEqual(TASKS.map((t) => ({ ...t })));
		expect(log.at(-1)).toBe(`kv.set ${SCHEDULES_FLAG}`);
		expect(kv.get(SCHEDULES_FLAG)).toEqual({ at: "2026-10-22T10:00:00.000Z" });
	});

	it("does not set the flag when a schedule fails, so the next check retries", async () => {
		const { ctx, kv } = fakeCtx({ failSchedule: true });
		await expect(scheduleRecurring(ctx, TASKS, NOW)).rejects.toThrow("cron down");
		expect(kv.has(SCHEDULES_FLAG)).toBe(false);
	});

	it("does not set the flag without a cron API", async () => {
		const { ctx, kv } = fakeCtx({ noCron: true });
		await scheduleRecurring(ctx, TASKS, NOW);
		expect(kv.has(SCHEDULES_FLAG)).toBe(false);
	});

	it("runEnsureSchedulesJob handles only its own task", async () => {
		const other = fakeCtx();
		expect(await runEnsureSchedulesJob({ name: "outbox-drain" }, other.ctx, TASKS, NOW)).toBe(false);
		expect(other.log).toEqual([]);

		const ours = fakeCtx();
		expect(await runEnsureSchedulesJob({ name: ENSURE_SCHEDULES_TASK }, ours.ctx, TASKS, NOW)).toBe(true);
		expect(ours.scheduled.map((t) => t.name)).toEqual(["sweep-holds", "outbox-drain"]);
		expect(ours.kv.has(SCHEDULES_FLAG)).toBe(true);
	});
});
