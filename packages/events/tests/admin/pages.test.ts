import { beforeEach, describe, expect, it } from "vitest";

import { type AdminDeps, type AdminStorage, handleAdmin } from "../../src/admin/pages";
import { makeStore, meter } from "../domain/fake-storage";

// Admin pages (EV-FR-11, EV-US-5, EV-US-7) with injected storage, settings and schema. The runtime
// test (admin.runtime.test.ts) proves the host validates what these return.

const NOW = Date.parse("2026-12-05T18:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

type Settings = Record<string, unknown>;
type Doc = Record<string, unknown>;

const MAPPED: Settings = {
	eventsCollection: "events",
	fieldStartsAt: "starts_at",
	fieldEndsAt: "ends_at",
	fieldTimezone: "timezone",
	fieldVenue: "venue",
	turnstileSecretKey: "secret",
};
const SCHEMAS = [
	{ slug: "events", fields: ["title", "starts_at", "ends_at", "timezone", "venue"].map((slug) => ({ slug })) },
];

beforeEach(() => {
	meter.calls = 0;
});

function world(settings: Settings = MAPPED, schemas = SCHEMAS) {
	const s = makeStore();
	s.event_configs.set("ev1", {
		status: "on_sale",
		capacity: 100,
		reserved: 52,
		sold: 40,
		currency: "GBP",
		questions: [],
		signature: { required: false, mode: "each_attendee" },
		waitlistEnabled: false,
	});
	s.ticket_types.set("tt_a", {
		eventId: "ev1",
		name: "Standard",
		priceMinor: 1500,
		capacity: 80,
		reserved: 2,
		sold: 30,
		hidden: false,
		sort: 0,
	});
	s.ticket_types.set("tt_b", {
		eventId: "ev1",
		name: "VIP",
		priceMinor: 4000,
		capacity: 20,
		reserved: 0,
		sold: 10,
		hidden: false,
		sort: 1,
	});
	s.bookings.set("bk_1", {
		ref: "REF1",
		eventId: "ev1",
		status: "confirmed",
		email: "ada@example.com",
		buyer: { name: "Ada Lovelace", email: "ada@example.com" },
		totals: { totalMinor: 1500, currency: "GBP" },
		createdAt: iso(NOW),
	});
	s.attendees.set("bk_1-1", {
		bookingId: "bk_1",
		eventId: "ev1",
		ticketTypeId: "tt_a",
		name: "Ada Lovelace",
		email: "ada@example.com",
		code: "CODE-ADA",
		status: "valid",
	});
	const deps: AdminDeps = {
		storage: s as unknown as AdminStorage,
		settings: {
			list: async () => {
				meter.calls++;
				return Object.entries(settings).map(([key, value]) => ({ key, value }));
			},
		},
		schema: {
			listCollections: async () => {
				meter.calls++;
				return schemas;
			},
		},
		now: NOW,
		pluginId: "semics-events",
		origin: "https://site.test",
		newId: () => "new_id",
	};
	return { s, deps };
}

const load = (deps: AdminDeps, page: string) => handleAdmin(deps, { type: "page_load", page });
const json = (v: unknown) => JSON.stringify(v);
const banners = (blocks: Array<{ type: string }>) =>
	blocks.filter((b) => b.type === "banner") as Array<{ title?: string; description?: string; variant?: string }>;
const find = <T extends { type: string }>(blocks: T[], type: string) => blocks.find((b) => b.type === type);

describe("setup page (EV-FR-01, T040, T047)", () => {
	it("a sound mapping and a Turnstile secret show no banners", async () => {
		const { deps } = world();
		const out = await load(deps, "/setup");
		expect(banners(out.blocks)).toEqual([]);
		expect(meter.calls).toBeLessThanOrEqual(8);
	});

	it("renders the validateMapping banner when a mapped field is missing", async () => {
		const { deps } = world({ ...MAPPED, fieldVenue: "place" });
		const out = await load(deps, "/setup");
		const [b] = banners(out.blocks);
		expect(b).toMatchObject({ variant: "error", title: "Events field mapping needs attention" });
		expect(b?.description).toContain('"place"');
	});

	it("renders the encryption key banner when a saved secret cannot be read", async () => {
		const { deps } = world({ ...MAPPED, turnstileSecretKey: { ciphertext: "x" } });
		const out = await load(deps, "/setup");
		expect(banners(out.blocks).map((b) => b.title)).toContain("Saved secrets cannot be read");
	});

	it("warns that checkout runs without a bot check when no Turnstile secret is set", async () => {
		const { deps } = world({ ...MAPPED, turnstileSecretKey: undefined });
		const out = await load(deps, "/setup");
		const warn = banners(out.blocks).find((b) => b.variant === "alert");
		expect(warn?.title).toMatch(/Turnstile/);
		expect(warn?.description).toMatch(/without a bot check/);
	});
});

describe("bookings page (EV-US-7)", () => {
	it("lists bookings in one call", async () => {
		const { deps } = world();
		const out = await load(deps, "/bookings");
		expect(meter.calls).toBeLessThanOrEqual(2);
		expect(json(out.blocks)).toContain("REF1");
		expect(json(out.blocks)).toContain("Ada Lovelace");
	});

	it("searches by reference or email and filters by status", async () => {
		const { deps, s } = world();
		s.bookings.set("bk_2", {
			...(s.bookings.docs.get("bk_1") as Doc),
			ref: "REF2",
			email: "bob@example.com",
			status: "cancelled",
		});
		const byEmail = await handleAdmin(deps, {
			type: "form_submit",
			action_id: "bookings.search",
			page: "/bookings",
			values: { q: "bob@example.com", status: "" },
		});
		expect(json(byEmail.blocks)).toContain("REF2");
		expect(json(byEmail.blocks)).not.toContain("REF1");
		const byRef = await handleAdmin(deps, {
			type: "form_submit",
			action_id: "bookings.search",
			page: "/bookings",
			values: { q: "REF1", status: "" },
		});
		expect(json(byRef.blocks)).not.toContain("REF2");
		const cancelled = await handleAdmin(deps, {
			type: "form_submit",
			action_id: "bookings.search",
			page: "/bookings",
			values: { q: "", status: "cancelled" },
		});
		expect(json(cancelled.blocks)).toContain("REF2");
		expect(json(cancelled.blocks)).not.toContain("REF1");
	});

	it("pages with a cursor: more than one page of bookings", async () => {
		const { deps, s } = world();
		for (let i = 0; i < 60; i++) s.bookings.set(`bk_x${i}`, { ...(s.bookings.docs.get("bk_1") as Doc), ref: `X${i}` });
		const first = await load(deps, "/bookings");
		const table = find(first.blocks, "table") as { next_cursor?: string; page_action_id: string; rows: unknown[] };
		expect(table.rows.length).toBeLessThanOrEqual(50);
		expect(table.next_cursor).toBeTruthy();
		const next = await handleAdmin(deps, {
			type: "block_action",
			action_id: table.page_action_id,
			page: "/bookings",
			value: table.next_cursor,
		});
		expect((find(next.blocks, "table") as { rows: unknown[] }).rows.length).toBeGreaterThan(0);
	});
});

describe("attendees page and check-in (EV-US-5)", () => {
	it("without an event it lists events to open", async () => {
		const { deps } = world();
		const out = await load(deps, "/attendees");
		expect(json(out.blocks)).toContain("ev1");
		expect(json(out.blocks)).toContain("attendees.open");
	});

	it("shows an event's attendees with check-in buttons, a CSV link and its status", async () => {
		const { deps } = world();
		const out = await handleAdmin(deps, {
			type: "block_action",
			action_id: "attendees.open",
			page: "/attendees",
			value: "ev1",
		});
		expect(meter.calls).toBeLessThanOrEqual(8);
		const text = json(out.blocks);
		expect(text).toContain("Ada Lovelace");
		expect(text).toContain("attendees.checkin");
		expect(text).toContain("/_emdash/api/plugins/semics-events/attendees/export?eventId=ev1");
	});

	it("checks in by code, then a second time shows the first check-in", async () => {
		const { deps, s } = world();
		const submit = (code: string) =>
			handleAdmin(deps, {
				type: "form_submit",
				action_id: "attendees.checkin_code",
				page: "/attendees",
				values: { eventId: "ev1", code },
			});
		const first = await submit("CODE-ADA");
		expect(banners(first.blocks)[0]).toMatchObject({
			variant: "default",
			title: expect.stringContaining("Checked in"),
		});
		expect(typeof (s.attendees.docs.get("bk_1-1") as Doc).checkedInAt).toBe("string");
		const firstAt = (s.attendees.docs.get("bk_1-1") as Doc).checkedInAt as string;
		const second = await handleAdmin(
			{ ...deps, now: NOW + 600_000 },
			{
				type: "form_submit",
				action_id: "attendees.checkin_code",
				page: "/attendees",
				values: { eventId: "ev1", code: "CODE-ADA" },
			},
		);
		expect(banners(second.blocks)[0]).toMatchObject({ variant: "alert", title: "Already checked in" });
		expect(banners(second.blocks)[0]?.description).toContain(firstAt);
		expect((s.attendees.docs.get("bk_1-1") as Doc).checkedInAt).toBe(firstAt);
	});

	it("refuses a cancelled booking's attendee and explains why", async () => {
		const { deps, s } = world();
		s.bookings.set("bk_1", { ...(s.bookings.docs.get("bk_1") as Doc), status: "cancelled" });
		const out = await handleAdmin(deps, {
			type: "block_action",
			action_id: "attendees.checkin",
			page: "/attendees",
			value: { id: "bk_1-1", eventId: "ev1" },
		});
		expect(banners(out.blocks)[0]).toMatchObject({ variant: "error", title: "Cannot check in" });
		expect(banners(out.blocks)[0]?.description).toContain("not confirmed");
		expect((s.attendees.docs.get("bk_1-1") as Doc).checkedInAt).toBeUndefined();
	});

	it("EV-FR-12 refuses an attendee whose waiver is pending and shows the signing link (Pro seam)", async () => {
		const { deps, s } = world();
		s.bookings.set("bk_1", {
			...(s.bookings.docs.get("bk_1") as Doc),
			waiver: { templateId: "tpl", mode: "each_attendee" },
		});
		s.attendees.set("bk_1-1", { ...(s.attendees.docs.get("bk_1-1") as Doc), status: "pending" });
		const asked: Doc[] = [];
		const signingLink: NonNullable<AdminDeps["signingLink"]> = async (args) => {
			asked.push(args as unknown as Doc);
			return "https://site.test/_events/sign#intent=abc";
		};
		const checkin = (d: AdminDeps) =>
			handleAdmin(d, {
				type: "block_action",
				action_id: "attendees.checkin",
				page: "/attendees",
				value: { id: "bk_1-1", eventId: "ev1" },
			});
		const out = await checkin({ ...deps, signingLink });
		expect(banners(out.blocks)[0]).toMatchObject({ variant: "error", title: "Waiver not signed" });
		expect(json(out.blocks)).toContain("https://site.test/_events/sign#intent=abc");
		expect(asked[0]).toMatchObject({ attendeeId: "bk_1-1", attendee: { status: "pending" }, booking: { ref: "REF1" } });
		expect((s.attendees.docs.get("bk_1-1") as Doc).checkedInAt).toBeUndefined();
		// Pro without a link (no pairing): the refusal still explains itself, with no link.
		const none = await checkin({ ...deps, signingLink: async () => null });
		expect(banners(none.blocks)[0]?.description).toContain("waiver");
		expect(json(none.blocks)).not.toContain("_events/sign");
		expect((s.attendees.docs.get("bk_1-1") as Doc).checkedInAt).toBeUndefined();
		// T119 F6, R44: Free (no seam, e.g. after a downgrade) has no waivers to sign, so it checks them in.
		const free = await checkin(deps);
		expect(banners(free.blocks)[0]).toMatchObject({ variant: "default", title: expect.stringContaining("Checked in") });
	});

	it("undoes a check-in", async () => {
		const { deps, s } = world();
		await handleAdmin(deps, {
			type: "block_action",
			action_id: "attendees.checkin",
			page: "/attendees",
			value: { id: "bk_1-1", eventId: "ev1" },
		});
		await handleAdmin(deps, {
			type: "block_action",
			action_id: "attendees.undo",
			page: "/attendees",
			value: { id: "bk_1-1", eventId: "ev1" },
		});
		expect((s.attendees.docs.get("bk_1-1") as Doc).checkedInAt).toBeNull();
	});

	it("finds an attendee by name and stays within the call budget", async () => {
		const { deps } = world();
		meter.calls = 0;
		const out = await handleAdmin(deps, {
			type: "form_submit",
			action_id: "attendees.search",
			page: "/attendees",
			values: { eventId: "ev1", q: "lovel" },
		});
		expect(json(out.blocks)).toContain("CODE-ADA");
		expect(meter.calls).toBeLessThanOrEqual(8);
	});
});

describe("event editor (T044)", () => {
	const save = (deps: AdminDeps, values: Record<string, unknown>) =>
		handleAdmin(deps, {
			type: "form_submit",
			action_id: "event.save",
			page: "/events",
			values: { eventId: "ev1", ...values },
		});

	it("opens an event with a field for each ticket type", async () => {
		const { deps } = world();
		const out = await handleAdmin(deps, {
			type: "block_action",
			action_id: "events.edit",
			page: "/events",
			value: "ev1",
		});
		const text = json(out.blocks);
		expect(text).toContain("capacity:tt_a");
		expect(text).toContain("price:tt_b");
		expect(meter.calls).toBeLessThanOrEqual(3);
	});

	it("writes only the changed ticket type", async () => {
		const { deps, s } = world();
		const writes: string[] = [];
		for (const name of ["ticket_types", "event_configs"] as const) {
			const orig = s[name].updateIf.bind(s[name]);
			s[name].updateIf = (id, args) => {
				writes.push(`${name}:${id}`);
				return orig(id, args);
			};
		}
		meter.calls = 0;
		const out = await save(deps, {
			status: "on_sale",
			"capacity:tt_a": 90,
			"price:tt_a": "15.00",
			"capacity:tt_b": 20,
			"price:tt_b": "40.00",
		});
		expect(banners(out.blocks)[0]).toMatchObject({ variant: "default", title: "Saved" });
		expect(writes.filter((w) => w.startsWith("ticket_types"))).toEqual(["ticket_types:tt_a"]);
		expect((s.ticket_types.docs.get("tt_a") as Doc).capacity).toBe(90);
		expect(meter.calls).toBeLessThanOrEqual(8);
	});

	it("saying nothing changed writes nothing", async () => {
		const { deps } = world();
		const out = await save(deps, {
			status: "on_sale",
			"capacity:tt_a": 80,
			"price:tt_a": "15.00",
			"capacity:tt_b": 20,
			"price:tt_b": "40.00",
		});
		expect(banners(out.blocks)[0]).toMatchObject({ title: "Nothing to save" });
		expect(meter.calls).toBeLessThanOrEqual(3);
	});

	it("shows TOO_MANY_CHANGES as a plain message when a bulk edit is too big", async () => {
		const { deps, s } = world();
		const values: Record<string, unknown> = { status: "on_sale" };
		for (let i = 0; i < 8; i++) {
			s.ticket_types.set(`tt_${i}`, { ...(s.ticket_types.docs.get("tt_a") as Doc), name: `T${i}`, sort: i + 2 });
		}
		for (const id of s.ticket_types.docs.keys()) {
			values[`capacity:${id}`] = 95;
			values[`price:${id}`] = "9.99";
		}
		meter.calls = 0;
		const out = await save(deps, values);
		const b = banners(out.blocks)[0];
		expect(b).toMatchObject({ variant: "error", title: "Too many changes at once" });
		expect(meter.calls).toBeLessThanOrEqual(10);
	});

	it("shows a refusal below what is reserved", async () => {
		const { deps } = world();
		const out = await save(deps, {
			status: "on_sale",
			"capacity:tt_a": 1,
			"price:tt_a": "15.00",
			"capacity:tt_b": 20,
			"price:tt_b": "40.00",
		});
		expect(banners(out.blocks)[0]).toMatchObject({ variant: "error" });
		expect(banners(out.blocks)[0]?.description).toMatch(/reserved|sold/i);
	});
});

describe("dashboard widget (EV-US-7)", () => {
	it("meters read the sold and reserved counters", async () => {
		const { deps } = world();
		const out = await load(deps, "widget:sales");
		expect(meter.calls).toBeLessThanOrEqual(2);
		const m = find(out.blocks, "meter") as { label: string; value: number; max: number; custom_value: string };
		expect(m).toMatchObject({ value: 40, max: 100 });
		expect(m.label).toContain("ev1");
		expect(m.custom_value).toContain("12 held");
		expect(m.custom_value).toContain("40 sold");
	});

	it("says so when nothing is on sale", async () => {
		const { deps, s } = world();
		s.event_configs.set("ev1", { ...(s.event_configs.docs.get("ev1") as Doc), status: "draft" });
		const out = await load(deps, "widget:sales");
		expect(find(out.blocks, "meter")).toBeUndefined();
	});
});

describe("deletion on request (EV-FR-20, T087)", () => {
	const act = (deps: AdminDeps, action_id: string, value: unknown) =>
		handleAdmin(deps, { type: "block_action", action_id, value });
	const past = (s: ReturnType<typeof world>["s"]) => {
		s.event_configs.set("ev_past", {
			status: "closed",
			reserved: 1,
			sold: 1,
			info: { startsAt: iso(NOW - 30 * 86_400_000), endsAt: null },
		});
		s.bookings.set("bk_old", {
			ref: "OLD1",
			eventId: "ev_past",
			status: "confirmed",
			email: "ada@example.com",
			buyer: { name: "Ada Lovelace", email: "ada@example.com" },
			totals: { totalMinor: 1500, currency: "GBP" },
			answers: { diet: "none" },
			ipHash: "ip",
			createdAt: iso(NOW - 60 * 86_400_000),
		});
		s.attendees.set("bk_old-1", {
			bookingId: "bk_old",
			eventId: "ev_past",
			ticketTypeId: "tt_a",
			name: "Ada Lovelace",
			email: "ada@example.com",
			code: "CODE-OLD",
			status: "valid",
		});
	};

	it("the bookings page offers the deletion form", async () => {
		const { deps } = world();
		const out = await load(deps, "/bookings");
		expect(json(out.blocks)).toContain("retention.preview");
	});

	it("a search previews, then a confirmed delete erases personal fields, keeps counts and live bookings", async () => {
		const w = world();
		past(w.s);
		const preview = await handleAdmin(w.deps, {
			type: "form_submit",
			action_id: "retention.preview",
			values: { target: "ada@example.com" },
		});
		expect(json(preview.blocks)).toContain("retention.erase");
		expect(json(preview.blocks)).toContain("confirm");
		meter.calls = 0;
		const out = await act(w.deps, "retention.erase", "ada@example.com");
		expect(meter.calls).toBeLessThanOrEqual(8);
		expect(w.s.bookings.docs.get("bk_old")).toMatchObject({
			email: "",
			buyer: { name: "", email: "" },
			ipHash: null,
			status: "confirmed",
			totals: { totalMinor: 1500 },
		});
		// The fixture's other booking has no known event date, so it counts as live and stays.
		expect(w.s.bookings.docs.get("bk_1")).toMatchObject({ email: "ada@example.com" });
		expect(w.s.attendees.docs.get("bk_old-1")).toMatchObject({ name: "", email: "" });
		expect(w.s.event_configs.docs.get("ev_past")).toMatchObject({ reserved: 1, sold: 1 });
		expect(json(out.blocks)).toContain("Deleted personal data of 1 booking");
		expect(json(out.blocks)).toContain("live booking was kept");
	});

	it("EV-FR-16 T081 deletion by email also removes that person's waitlist entries, within budget", async () => {
		const w = world();
		past(w.s);
		const wl = (email: string) => ({ eventId: "ev1", email, name: "Ada", qty: 1, status: "waiting", createdAt: iso(NOW) });
		w.s.waitlist.set("wl_ada", wl("ada@example.com"));
		w.s.waitlist.set("wl_bob", wl("bob@example.com"));
		const preview = await handleAdmin(w.deps, {
			type: "form_submit",
			action_id: "retention.preview",
			values: { target: "Ada@Example.com" },
		});
		expect(json(preview.blocks)).toContain("1 waitlist entry");
		meter.calls = 0;
		const out = await act(w.deps, "retention.erase", "Ada@Example.com");
		expect(meter.calls).toBeLessThanOrEqual(10);
		expect([...w.s.waitlist.docs.keys()]).toEqual(["wl_bob"]);
		expect(json(out.blocks)).toContain("1 waitlist entry");

		// Someone only on a waitlist can be found and deleted too.
		w.s.waitlist.set("wl_cy", wl("cy@example.com"));
		const only = await handleAdmin(w.deps, {
			type: "form_submit",
			action_id: "retention.preview",
			values: { target: "cy@example.com" },
		});
		expect(json(only.blocks)).toContain("retention.erase");
		await act(w.deps, "retention.erase", "cy@example.com");
		expect(w.s.waitlist.docs.has("wl_cy")).toBe(false);
	});

	it("a booking reference works, and an unknown one offers no delete", async () => {
		const w = world();
		past(w.s);
		const none = await handleAdmin(w.deps, {
			type: "form_submit",
			action_id: "retention.preview",
			values: { target: "nope" },
		});
		expect(json(none.blocks)).not.toContain("retention.erase");
		await act(w.deps, "retention.erase", "old1");
		expect(w.s.bookings.docs.get("bk_old")?.erasedAt).toBeTruthy();
	});
});
