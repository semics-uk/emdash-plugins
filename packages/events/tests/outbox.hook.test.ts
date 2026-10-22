import { createPluginRuntimeTestHost, type PluginRuntimeTestHost } from "@emdash-cms/plugin-test";
import { generateToken, hashToken } from "@semics-tech/shared";
import { expectWithinBudget, withBudget } from "@semics-tech/shared/testing";
import { afterEach, describe, expect, it } from "vitest";

// The shipped plugin: activation schedules `outbox-drain`, the cron hook sends the queued
// confirmation (rendered at send time) and the calendar routes answer raw `text/calendar` (T050).

let runtime: PluginRuntimeTestHost | undefined;
afterEach(async () => {
	await runtime?.dispose();
	runtime = undefined;
});

const ID = "bk_0123456789abcdef0123456789abcdef";
const REF = "ABCDEFGHJK";
const host = () => runtime as PluginRuntimeTestHost;

async function seed() {
	runtime = await createPluginRuntimeTestHost({ site: { name: "Town Hall", url: "https://site.test" } });
	await runtime.fixtures.collection({
		slug: "events",
		label: "Events",
		fields: [
			{ slug: "title", label: "Title", type: "string" },
			{ slug: "starts_at", label: "Starts", type: "datetime" },
			{ slug: "ends_at", label: "Ends", type: "datetime" },
			{ slug: "timezone", label: "Timezone", type: "string" },
			{ slug: "venue", label: "Venue", type: "string" },
		],
	});
	const entry = await runtime.fixtures.content("events", {
		slug: "winter-concert",
		status: "published",
		data: {
			title: "Winter Concert",
			starts_at: "2026-11-14T19:00:00.000Z",
			ends_at: "2026-11-14T21:00:00.000Z",
			timezone: "Europe/London",
			venue: "Town Hall",
		},
	});
	const token = generateToken();
	await runtime.fixtures.plugin.storage("bookings", ID, {
		ref: REF,
		eventId: entry.id,
		status: "confirmed",
		releaseClaimedAt: null,
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		email: "ada@example.com",
		lines: [{ ticketTypeId: "tt", qty: 1, unitPriceMinor: 0 }],
		totals: { subtotalMinor: 0, discountMinor: 0, totalMinor: 0, currency: "GBP" },
		answers: {},
		accessTokenHash: await hashToken(token),
		createdAt: new Date().toISOString(),
	});
	await runtime.fixtures.plugin.storage("attendees", `${ID}-1`, {
		bookingId: ID,
		eventId: entry.id,
		ticketTypeId: "tt",
		name: "Ada Lovelace",
		email: "ada@example.com",
		code: "pass-code-1",
		status: "valid",
	});
	await runtime.fixtures.plugin.storage("outbox", `confirm-${ID}`, {
		kind: "booking_confirmed",
		to: "ada@example.com",
		payload: { bookingId: ID, bookingRef: REF },
		attempts: 0,
		nextAttemptAt: new Date(Date.now() - 1000).toISOString(),
		status: "pending",
	});
	return { token };
}

describe("outbox-drain in the shipped plugin (EV-FR-08, R22, R23)", () => {
	it("EV-FR-08 activation schedules the every-minute drain", async () => {
		runtime = await createPluginRuntimeTestHost();
		await runtime.actions.plugin.activate();
		const tasks = await runtime.inspect.scheduledTasks();
		expect(tasks).toEqual(
			expect.arrayContaining([expect.objectContaining({ name: "outbox-drain", schedule: "* * * * *" })]),
		);
		expect(tasks).toEqual(expect.arrayContaining([expect.objectContaining({ name: "sweep-holds" })]));
	});

	it("EV-FR-08 the cron hook sends the confirmation within budget, then the calendar link works", async () => {
		await seed();
		const budget = withBudget(host());
		const r = await budget.invokeHook("cron", { name: "outbox-drain", scheduledAt: new Date().toISOString() });
		expectWithinBudget(r, { calls: 8 });
		const mail = await host().inspect.email();
		expect(mail).toHaveLength(1);
		expect(JSON.stringify(mail[0])).toContain("Winter Concert");
		expect(await host().inspect.storage.get("outbox", `confirm-${ID}`)).toMatchObject({ status: "sent" });
	});

	it("EV-FR-08 the booking calendar route rejects an unsigned request with a JSON error", async () => {
		await seed();
		const budget = withBudget(host());
		const r = await budget.invokeRoute(
			"public/booking/ics",
			{},
			{ url: "https://site.test/x?ref=ABCDEFGHJK", method: "GET" },
		);
		expectWithinBudget(r, { calls: 3 });
		const body = r.value as { status?: number; body?: { value?: string } };
		expect(body.status).toBe(401);
		expect(JSON.parse(body.body?.value ?? "{}").error.code).toBe("TOKEN_INVALID");
	});

	it("EV-FR-08 the event calendar route serves text/calendar without a signature", async () => {
		await seed();
		const entry = (await host().inspect.storage.list<{ eventId: string }>("bookings"))[0]?.data.eventId ?? "";
		const budget = withBudget(host());
		const r = await budget.invokeRoute(
			"public/event/ics",
			{},
			{ url: `https://site.test/x?eventId=${entry}`, method: "GET" },
		);
		expectWithinBudget(r, { calls: 5 });
		const raw = r.value as { status?: number; headers?: Record<string, string>; body?: { value?: string } };
		expect(raw.status).toBe(200);
		expect(raw.body?.value).toContain("TZID:Europe/London");
	});
});
