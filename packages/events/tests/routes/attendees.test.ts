import { beforeEach, describe, expect, it } from "vitest";

import { type AttendeeStorage, checkIn, exportAttendeesCsv, undoCheckIn } from "../../src/routes/attendees";
import { makeStore, meter } from "../domain/fake-storage";

// Admin check-in, undo and CSV export (EV-FR-11, EV-US-5, EV-US-7): attendee docs are
// `<bookingId>-<n>`; a booking that is not confirmed never checks in (cancel leaves attendees valid).

const NOW = Date.parse("2026-12-05T18:00:00.000Z");
const LATER = NOW + 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

beforeEach(() => {
	meter.calls = 0;
});

function world(bookingStatus = "confirmed") {
	const s = makeStore();
	s.bookings.set("bk_1", { ref: "REF1", eventId: "ev1", status: bookingStatus, email: "ada@example.com" });
	s.attendees.set("bk_1-1", {
		bookingId: "bk_1",
		eventId: "ev1",
		ticketTypeId: "tt_a",
		name: "Ada Lovelace",
		email: "ada@example.com",
		code: "CODE-ADA",
		status: "valid",
	});
	return { s, storage: s as unknown as AttendeeStorage };
}

describe("check-in (EV-US-5)", () => {
	it("EV-US-5 checks in by id and by code", async () => {
		const { s, storage } = world();
		const byId = await checkIn(storage, { id: "bk_1-1" }, iso(NOW));
		expect(byId).toMatchObject({ ok: true, checkedInAt: iso(NOW) });
		expect((s.attendees.docs.get("bk_1-1") as { checkedInAt: string }).checkedInAt).toBe(iso(NOW));
		s.attendees.docs.set("bk_1-1", { ...s.attendees.docs.get("bk_1-1"), checkedInAt: null });
		const byCode = await checkIn(storage, { code: "CODE-ADA" }, iso(NOW));
		expect(byCode).toMatchObject({ ok: true, id: "bk_1-1" });
	});

	it("EV-US-5 a second check-in shows the first time and writes nothing", async () => {
		const { s, storage } = world();
		await checkIn(storage, { id: "bk_1-1" }, iso(NOW));
		const again = await checkIn(storage, { id: "bk_1-1" }, iso(LATER));
		expect(again).toMatchObject({ ok: false, reason: "ALREADY_CHECKED_IN", checkedInAt: iso(NOW) });
		expect((s.attendees.docs.get("bk_1-1") as { checkedInAt: string }).checkedInAt).toBe(iso(NOW));
	});

	it("EV-US-5 refuses attendees whose booking is not confirmed", async () => {
		for (const status of ["cancelled", "held", "refunded", "expired"]) {
			const { s, storage } = world(status);
			const out = await checkIn(storage, { id: "bk_1-1" }, iso(NOW));
			expect(out, status).toMatchObject({ ok: false, reason: "BOOKING_NOT_CONFIRMED" });
			expect((s.attendees.docs.get("bk_1-1") as { checkedInAt?: string }).checkedInAt).toBeUndefined();
		}
	});

	it("EV-US-5 refuses a pending attendee and an unknown code or id", async () => {
		const { s, storage } = world();
		s.attendees.set("bk_1-1", { ...(s.attendees.docs.get("bk_1-1") as object), status: "pending" });
		expect(await checkIn(storage, { id: "bk_1-1" }, iso(NOW))).toMatchObject({
			ok: false,
			reason: "ATTENDEE_NOT_VALID",
		});
		expect(await checkIn(storage, { code: "NOPE" }, iso(NOW))).toMatchObject({ ok: false, reason: "NOT_FOUND" });
		expect(await checkIn(storage, { id: "zzz" }, iso(NOW))).toMatchObject({ ok: false, reason: "NOT_FOUND" });
	});

	it("EV-US-5 a code from another event is not found when an event is given", async () => {
		const { storage } = world();
		expect(await checkIn(storage, { code: "CODE-ADA" }, iso(NOW), "other")).toMatchObject({ reason: "NOT_FOUND" });
	});

	it("EV-US-5 undo clears the time, and a second undo is harmless", async () => {
		const { s, storage } = world();
		await checkIn(storage, { id: "bk_1-1" }, iso(NOW));
		expect(await undoCheckIn(storage, "bk_1-1")).toMatchObject({ ok: true });
		expect((s.attendees.docs.get("bk_1-1") as { checkedInAt: unknown }).checkedInAt).toBeNull();
		expect(await undoCheckIn(storage, "bk_1-1")).toMatchObject({ ok: true });
		expect(await undoCheckIn(storage, "zzz")).toMatchObject({ ok: false, reason: "NOT_FOUND" });
	});

	it("EV-US-5 check-in stays within the bridge-call target", async () => {
		const { storage } = world();
		meter.calls = 0;
		await checkIn(storage, { code: "CODE-ADA" }, iso(NOW));
		const first = meter.calls;
		meter.calls = 0;
		await checkIn(storage, { code: "CODE-ADA" }, iso(LATER));
		expect(first).toBeLessThanOrEqual(8);
		expect(meter.calls).toBeLessThanOrEqual(8);
	});
});

describe("attendee CSV (EV-FR-11, EV-US-7)", () => {
	it("EV-FR-11 exports one page with escaped cells and the booking status", async () => {
		const { s, storage } = world();
		s.attendees.set("bk_1-2", {
			bookingId: "bk_1",
			eventId: "ev1",
			ticketTypeId: "tt_a",
			name: '=cmd|"x", Bob',
			email: "b@example.com",
			code: "CODE-B",
			status: "valid",
			checkedInAt: iso(NOW),
		});
		meter.calls = 0;
		const out = await exportAttendeesCsv(storage, { eventId: "ev1" });
		expect(meter.calls).toBeLessThanOrEqual(8);
		const lines = out.csv.split("\r\n");
		expect(lines[0]).toBe("Name,Email,Code,Ticket type,Booking,Booking status,Attendee status,Checked in");
		expect(lines[1]).toContain("Ada Lovelace,ada@example.com,CODE-ADA,tt_a,REF1,confirmed,valid,");
		expect(lines[2]).toContain(`"'=cmd|""x"", Bob"`);
		expect(lines[2]).toContain(iso(NOW));
		expect(out.nextCursor).toBeUndefined();
	});

	it("EV-FR-11 pages large events: 100 rows a part with a cursor, never over budget", async () => {
		const { s, storage } = world();
		for (let i = 2; i <= 130; i++) {
			s.attendees.set(`bk_1-${i}`, { ...(s.attendees.docs.get("bk_1-1") as object), code: `C${i}`, name: `N${i}` });
		}
		meter.calls = 0;
		const first = await exportAttendeesCsv(storage, { eventId: "ev1" });
		expect(meter.calls).toBeLessThanOrEqual(8);
		expect(first.csv.trim().split("\r\n")).toHaveLength(101);
		expect(first.nextCursor).toBeTruthy();
		const second = await exportAttendeesCsv(storage, { eventId: "ev1", cursor: first.nextCursor });
		expect(second.csv.trim().split("\r\n")).toHaveLength(31);
		expect(second.nextCursor).toBeUndefined();
	});
});
