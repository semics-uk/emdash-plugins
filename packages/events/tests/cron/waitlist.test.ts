import { generateToken, hashToken } from "@semics-tech/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { WAITLIST_SCHEDULE, WAITLIST_TASK, type WaitlistStorage, waitlistTick } from "../../src/cron/waitlist";
import { expireBookings, type HoldStorage, planExpiries } from "../../src/domain/holds";
import { OFFER_HOURS } from "../../src/domain/waitlist";
import { type RedeemDeps, redeemBooking } from "../../src/routes/redeem";
import { makeStore, meter } from "../domain/fake-storage";

// The waitlist offer job (EV-FR-16, EV-US-6, R22) over in-memory storage with the host's guarded
// `updateIf` semantics: a freed seat goes to the earliest entry as a normal held booking (the same
// inventory guards as checkout), an unclaimed offer lapses and passes on, and every tick stays within
// the bridge budget.

const HOUR = 3_600_000;
const T0 = Date.parse("2026-11-01T12:00:00.000Z");
const at = (hours: number) => new Date(T0 + hours * HOUR).toISOString();

beforeEach(() => {
	meter.calls = 0;
});

// biome-ignore lint/suspicious/noExplicitAny: test reads loose documents
type Doc = Record<string, any>;

interface WorldOptions {
	capacity?: number;
	reserved?: number;
	typeCapacity?: number;
	occurrence?: boolean;
	eventId?: string;
}

function event(s: ReturnType<typeof makeStore>, o: WorldOptions = {}) {
	const { capacity = 2, reserved = 2, typeCapacity = capacity, occurrence = false, eventId = "ev1" } = o;
	const tt = `${eventId}_tt`;
	s.event_configs.set(eventId, {
		status: "on_sale",
		capacity,
		reserved,
		sold: reserved,
		currency: "GBP",
		questions: [],
		signature: { required: false, mode: "each_attendee" },
		waitlistEnabled: true,
		catalog: {
			ticketTypes: { [tt]: { capacity: typeCapacity, priceMinor: 0, hidden: false } },
			occurrences: occurrence ? { [`${eventId}_oc`]: { capacity, startsAt: at(240), status: "open" } } : {},
		},
		info: { title: "Gig", startsAt: at(240), endsAt: null, timezone: null, venue: null },
	});
	s.ticket_types.set(tt, { eventId, name: "Entry", capacity: typeCapacity, reserved, sold: reserved, priceMinor: 0 });
	if (occurrence) {
		s.occurrences.set(`${eventId}_oc`, {
			eventId,
			capacity,
			reserved,
			sold: reserved,
			startsAt: at(240),
			status: "open",
		});
	}
	return { tt, oc: occurrence ? `${eventId}_oc` : undefined };
}

function entry(s: ReturnType<typeof makeStore>, id: string, extra: Doc = {}) {
	s.waitlist.set(id, {
		eventId: "ev1",
		email: `${id}@example.com`,
		name: `Person ${id}`,
		qty: 1,
		status: "waiting",
		createdAt: at(-10),
		...extra,
	});
}

/** Free `n` seats, as a cancel or an expiry would (inventory's `release`). */
function free(s: ReturnType<typeof makeStore>, n: number, eventId = "ev1") {
	for (const c of [s.event_configs, s.ticket_types, s.occurrences]) {
		for (const [id, d] of c.docs) {
			if (id === eventId || d.eventId === eventId) c.docs.set(id, { ...d, reserved: (d.reserved as number) - n });
		}
	}
}

const tick = (s: ReturnType<typeof makeStore>, now = T0) =>
	waitlistTick({ storage: s as unknown as WaitlistStorage, now });

const heldBookings = (s: ReturnType<typeof makeStore>) =>
	[...s.bookings.docs.entries()].filter(([, b]) => b.status === "held");

describe("waitlist offers (EV-FR-16, EV-US-6)", () => {
	it("is a recurring task", () => {
		expect(WAITLIST_TASK).toBe("waitlist");
		expect(WAITLIST_SCHEDULE.split(" ")).toHaveLength(5);
	});

	it("EV-FR-16 freed seat offers to the earliest entry", async () => {
		const s = makeStore();
		const { tt } = event(s);
		entry(s, "wl_b", { createdAt: at(-5) });
		entry(s, "wl_a", { createdAt: at(-9) });
		// Sold out: nothing to offer, and nothing is written.
		await tick(s);
		expect(s.waitlist.docs.get("wl_a")?.status).toBe("waiting");
		expect(s.bookings.docs.size).toBe(0);

		free(s, 1);
		await tick(s);
		const a = s.waitlist.docs.get("wl_a") as Doc;
		expect(a.status).toBe("offered");
		expect(a.offerExpiresAt).toBe(at(OFFER_HOURS));
		expect(s.waitlist.docs.get("wl_b")?.status).toBe("waiting");

		// The offer is a normal hold in the waitlister's name, until the offer ends.
		const booking = s.bookings.docs.get(a.bookingId) as Doc;
		expect(booking).toMatchObject({
			eventId: "ev1",
			status: "held",
			email: "wl_a@example.com",
			buyer: { name: "Person wl_a", email: "wl_a@example.com" },
			lines: [{ ticketTypeId: tt, qty: 1, unitPriceMinor: 0 }],
			holdExpiresAt: at(OFFER_HOURS),
			releaseClaimedAt: null,
			waitlistId: "wl_a",
		});
		expect(s.event_configs.docs.get("ev1")?.reserved).toBe(2);
		expect(s.ticket_types.docs.get(tt)?.reserved).toBe(2);

		// The email goes through the outbox, ids only: rendered (and its code minted) at send time.
		const row = s.outbox.docs.get(`offer-${a.bookingId}`) as Doc;
		expect(row).toMatchObject({ kind: "waitlist_offer", to: "wl_a@example.com", status: "pending" });
		expect(row.payload).toEqual({ bookingId: a.bookingId });

		// Sold out again: B keeps waiting.
		await tick(s, T0 + 60_000);
		expect(s.waitlist.docs.get("wl_b")?.status).toBe("waiting");
		expect(heldBookings(s)).toHaveLength(1);
	});

	it("EV-FR-16 an entry asking for more seats than are free waits; a later one that fits is offered", async () => {
		const s = makeStore();
		event(s, { capacity: 4, reserved: 4 });
		entry(s, "wl_big", { qty: 3, createdAt: at(-9) });
		entry(s, "wl_one", { createdAt: at(-5) });
		free(s, 1);
		await tick(s);
		expect(s.waitlist.docs.get("wl_big")?.status).toBe("waiting");
		expect(s.waitlist.docs.get("wl_one")?.status).toBe("offered");
	});

	it("EV-FR-16 expired offer moves to the next", async () => {
		const s = makeStore();
		event(s);
		entry(s, "wl_a", { createdAt: at(-9) });
		entry(s, "wl_b", { createdAt: at(-5) });
		free(s, 1);
		await tick(s);
		expect(s.waitlist.docs.get("wl_a")?.status).toBe("offered");

		// Nobody claims it: the hold lapses and the sweeper expires it like any other (T045).
		const later = T0 + (OFFER_HOURS + 0.1) * HOUR;
		const items = [...s.bookings.docs.entries()].map(([id, data]) => ({ id, data }));
		const { planned } = planExpiries(items, later, 10);
		expect(planned).toHaveLength(1);
		await expireBookings(s as unknown as HoldStorage, planned, later);
		expect(s.event_configs.docs.get("ev1")?.reserved).toBe(1);

		// Lapsed offers are marked every five minutes, on a tick that makes no offer.
		for (let i = 0; i < 6; i++) await tick(s, later + i * 60_000);
		expect(s.waitlist.docs.get("wl_a")?.status).toBe("expired");
		expect(s.waitlist.docs.get("wl_b")?.status).toBe("offered");
		const b = s.bookings.docs.get(String(s.waitlist.docs.get("wl_b")?.bookingId)) as Doc;
		expect(b).toMatchObject({ status: "held", email: "wl_b@example.com" });
		expect(s.event_configs.docs.get("ev1")?.reserved).toBe(2);
	});

	it("EV-FR-16 two claims for one seat: one wins", async () => {
		const s = makeStore();
		const { tt } = event(s);
		entry(s, "wl_a", { createdAt: at(-9) });
		entry(s, "wl_b", { createdAt: at(-5) });
		free(s, 1);
		// Two overlapping ticks race for the one free seat: the inventory guards let one through.
		await Promise.all([tick(s), tick(s)]);
		expect(heldBookings(s)).toHaveLength(1);
		expect(s.event_configs.docs.get("ev1")?.reserved).toBe(2);
		expect(s.ticket_types.docs.get(tt)?.reserved).toBe(2);
		const statuses = [s.waitlist.docs.get("wl_a")?.status, s.waitlist.docs.get("wl_b")?.status].sort();
		expect(statuses).toEqual(["offered", "waiting"]);
		expect(s.outbox.docs.size).toBe(1);

		// Two claims of the emailed code: one gets the booking, the other the same NOT_FOUND as a wrong code.
		const [[id, booking]] = heldBookings(s) as [[string, Doc]];
		const code = generateToken();
		s.bookings.docs.set(id, { ...booking, redeemHash: await hashToken(code), redeemExpiresAt: at(OFFER_HOURS) });
		const deps: RedeemDeps = { storage: s as unknown as RedeemDeps["storage"], now: T0 + HOUR };
		const claims = await Promise.all([
			redeemBooking(deps, { bookingRef: booking.ref, code }, { claim: true }),
			redeemBooking(deps, { bookingRef: booking.ref, code }, { claim: true }),
		]);
		const won = claims.filter((c) => (c as { ok: boolean }).ok);
		expect(won).toHaveLength(1);
		expect(won[0]).toMatchObject({ bookingRef: booking.ref, accessToken: expect.any(String) });
		expect(claims.find((c) => !(c as { ok: boolean }).ok)).toMatchObject({ error: { code: "NOT_FOUND" } });
		expect(s.waitlist.docs.get(booking.waitlistId)?.status).toBe("claimed");
	});

	it("EV-FR-16 a claim needs the offer's code, and a lapsed offer cannot be claimed", async () => {
		const s = makeStore();
		event(s);
		entry(s, "wl_a");
		free(s, 1);
		await tick(s);
		const [[id, booking]] = heldBookings(s) as [[string, Doc]];
		const code = generateToken();
		s.bookings.docs.set(id, { ...booking, redeemHash: await hashToken(code), redeemExpiresAt: at(OFFER_HOURS) });
		const deps = (now: number): RedeemDeps => ({ storage: s as unknown as RedeemDeps["storage"], now });
		const wrong = await redeemBooking(deps(T0), { bookingRef: booking.ref, code: generateToken() }, { claim: true });
		expect(wrong).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
		const late = await redeemBooking(deps(T0 + 25 * HOUR), { bookingRef: booking.ref, code }, { claim: true });
		expect(late).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
		expect(s.waitlist.docs.get("wl_a")?.status).toBe("offered");
	});

	it("R22 cron batches within budget: many entries and events, each tick at most 10 calls (8 without dates)", async () => {
		const s = makeStore();
		event(s, { eventId: "ev1", capacity: 10, reserved: 10 });
		event(s, { eventId: "ev2", capacity: 10, reserved: 10, occurrence: true });
		// A ticket type smaller than its event: whether it has room is read before offering.
		event(s, { eventId: "ev3", capacity: 10, reserved: 10, typeCapacity: 6 });
		let n = 0;
		for (const eventId of ["ev1", "ev2", "ev3"]) {
			for (let i = 0; i < 12; i++) {
				n++;
				entry(s, `wl_${eventId}_${String(i).padStart(2, "0")}`, {
					eventId,
					...(eventId === "ev2" ? { occurrenceId: "ev2_oc" } : {}),
					qty: 1 + (i % 2),
					createdAt: at(-100 + n),
				});
			}
		}
		free(s, 4, "ev1");
		free(s, 4, "ev2");
		free(s, 4, "ev3");
		s.ticket_types.docs.set("ev3_tt", { ...(s.ticket_types.docs.get("ev3_tt") as Doc), reserved: 6 });
		for (let i = 0; i < 30; i++) {
			const before = meter.calls;
			await tick(s, T0 + i * 60_000);
			const calls = meter.calls - before;
			expect(calls, `tick ${i}`).toBeLessThanOrEqual(10);
		}
		for (const eventId of ["ev1", "ev2", "ev3"]) {
			const config = s.event_configs.docs.get(eventId) as Doc;
			expect(config.reserved, eventId).toBeLessThanOrEqual(config.capacity);
		}
		const offered = (eventId: string) =>
			[...s.waitlist.docs.entries()]
				.filter(([, e]) => e.eventId === eventId && e.status === "offered")
				.map(([id, e]) => [id, e.qty]);
		// ev1: four seats in join order (1 + 2 + 1); ev2 the same, by date; ev3 has no room in its only type.
		expect(offered("ev1")).toEqual([
			["wl_ev1_00", 1],
			["wl_ev1_01", 2],
			["wl_ev1_02", 1],
		]);
		expect(offered("ev2")).toHaveLength(3);
		expect(offered("ev3")).toEqual([]);
		expect(s.event_configs.docs.get("ev1")?.reserved).toBe(10);
		expect(s.event_configs.docs.get("ev3")?.reserved).toBe(6);
		// No dead bookings from a type without room: it was read, not tried.
		expect([...s.bookings.docs.values()].filter((b) => b.eventId === "ev3")).toEqual([]);
	});

	it("R22 a tick for an event without dates is at most 8 calls; an idle minute costs one call", async () => {
		const s = makeStore();
		event(s, { capacity: 10, reserved: 10, typeCapacity: 4 });
		entry(s, "wl_a", { qty: 2 });
		free(s, 2);
		s.ticket_types.docs.set("ev1_tt", { ...(s.ticket_types.docs.get("ev1_tt") as Doc), reserved: 1 });
		meter.calls = 0;
		await tick(s);
		expect(s.waitlist.docs.get("wl_a")?.status).toBe("offered");
		expect(meter.calls).toBeLessThanOrEqual(8);

		const idle = makeStore();
		meter.calls = 0;
		await tick(idle, T0 + 60_000);
		expect(meter.calls).toBe(1);
	});

	it("skips events that are not taking a waitlist: switched off, paused, unpublished", async () => {
		const s = makeStore();
		event(s, { eventId: "ev1" });
		event(s, { eventId: "ev2" });
		event(s, { eventId: "ev3" });
		const patch = (id: string, p: Doc) =>
			s.event_configs.docs.set(id, { ...(s.event_configs.docs.get(id) as Doc), ...p });
		patch("ev1", { waitlistEnabled: false });
		patch("ev2", { status: "paused" });
		patch("ev3", { unpublished: true });
		for (const id of ["ev1", "ev2", "ev3"]) {
			entry(s, `wl_${id}`, { eventId: id });
			free(s, 1, id);
		}
		await tick(s);
		expect(s.bookings.docs.size).toBe(0);
	});
});
