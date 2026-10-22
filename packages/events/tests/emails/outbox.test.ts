import { hashToken } from "@semics-tech/shared";
import { beforeEach, describe, expect, it } from "vitest";

import { drainEventsOutbox, OUTBOX_PER_TICK } from "../../src/emails/outbox";
import { meter } from "../domain/fake-storage";
import { type Doc, ID, NOW, REF, world } from "./world";

// The events side of the shared outbox (T015, EV-FR-08, EV-FR-09, R22, R32): rows hold ids only;
// the message is rendered when it is sent, with a fresh one-time booking link.

beforeEach(() => {
	meter.calls = 0;
});

const row = (w: Awaited<ReturnType<typeof world>>, id: string) => w.storage.outbox.docs.get(id) as Doc;
const codeFrom = (text: string) => /[?&]k=([A-Za-z0-9_-]{43})/.exec(text)?.[1] ?? "";

describe("EV-FR-08 confirmation from the outbox", () => {
	it("EV-FR-08 renders at send time, reads the attendees and marks the row sent without a body", async () => {
		const w = await world();
		const result = await drainEventsOutbox(w.deps());
		expect(result).toMatchObject({ sent: 1, failed: 0, gaveUp: 0 });
		const [mail] = w.sent;
		expect(mail?.to).toBe("ada@example.com");
		expect(mail?.subject).toContain("Winter Concert");
		expect(mail?.text).toContain("Grace Hopper");
		expect(mail?.text).toContain(`${"https://site.test"}/booking?ref=${REF}&k=`);
		expect(mail?.text).toContain("/_emdash/api/plugins/r_abc/public/event/ics?eventId=ev1");
		const stored = row(w, `confirm-${ID}`);
		expect(stored).toMatchObject({ status: "sent", attempts: 1, payload: { bookingId: ID, bookingRef: REF } });
		expect(stored.sentAt).toBe(new Date(NOW).toISOString());
		expect(JSON.stringify(stored)).not.toContain(codeFrom(mail?.text ?? ""));
		expect(stored).not.toHaveProperty("message");
	});

	it("EV-FR-08 the link carries a one-time code whose hash is all the booking stores; the access token is untouched", async () => {
		const w = await world();
		const before = w.booking().accessTokenHash;
		await drainEventsOutbox(w.deps());
		const code = codeFrom(w.sent[0]?.text ?? "");
		expect(code).toHaveLength(43);
		expect(code).not.toBe(w.token);
		const b = w.booking();
		expect(b.redeemHash).toBe(await hashToken(code));
		expect(b.redeemExpiresAt).toBe(new Date(NOW + 7 * 86_400_000).toISOString());
		expect(b.accessTokenHash).toBe(before);
		expect(JSON.stringify(b)).not.toContain(code);
		expect(w.sent[0]?.text).not.toContain(w.token);
		expect(w.sent[0]?.html).not.toContain(w.token);
	});

	it("EV-FR-08 a retry after a crash issues a new code and the earlier one stops working", async () => {
		const w = await world();
		await drainEventsOutbox(w.deps());
		w.storage.outbox.set(`confirm-${ID}`, { ...row(w, `confirm-${ID}`), status: "pending" });
		await drainEventsOutbox(w.deps());
		const [first, second] = w.sent.map((m) => codeFrom(m.text));
		expect(first).not.toBe(second);
		expect(w.booking().redeemHash).toBe(await hashToken(second ?? ""));
	});

	it("EV-FR-08 sends nothing for a booking that is no longer confirmed, and still closes the row", async () => {
		const w = await world({ status: "cancelled" });
		const result = await drainEventsOutbox(w.deps());
		expect(result.sent).toBe(1);
		expect(w.sent).toEqual([]);
		expect(row(w, `confirm-${ID}`).status).toBe("sent");
		expect(w.booking().redeemHash).toBeUndefined();
	});

	it("EV-FR-08 a failing transport backs the row off for a minute and keeps the error", async () => {
		const w = await world();
		const result = await drainEventsOutbox(
			w.deps({
				email: {
					send: async () => {
						throw new Error("smtp down");
					},
				},
			}),
		);
		expect(result).toMatchObject({ sent: 0, failed: 1 });
		expect(row(w, `confirm-${ID}`)).toMatchObject({
			status: "pending",
			attempts: 1,
			lastError: "smtp down",
			nextAttemptAt: new Date(NOW + 60_000).toISOString(),
		});
	});

	it("EV-FR-08 an unknown kind is retried then given up, never sent", async () => {
		const w = await world();
		w.storage.outbox.set("x1", { ...row(w, `confirm-${ID}`), kind: "mystery" });
		w.storage.outbox.docs.delete(`confirm-${ID}`);
		const result = await drainEventsOutbox(w.deps());
		expect(result.failed).toBe(1);
		expect(w.sent).toEqual([]);
		expect(row(w, "x1").lastError).toContain("mystery");
	});

	it("EV-FR-08 does nothing without a mail transport", async () => {
		const w = await world();
		const result = await drainEventsOutbox(w.deps({ email: undefined }));
		expect(result.sent).toBe(0);
		expect(row(w, `confirm-${ID}`).status).toBe("pending");
		expect(meter.calls).toBe(0);
	});

	it("EV-FR-08 skips rows that are not due yet", async () => {
		const w = await world();
		w.storage.outbox.set(`confirm-${ID}`, {
			...row(w, `confirm-${ID}`),
			nextAttemptAt: new Date(NOW + 1000).toISOString(),
		});
		expect((await drainEventsOutbox(w.deps())).sent).toBe(0);
	});
});

describe("EV-FR-09 cancellation from the outbox", () => {
	it("EV-FR-09 sends the booking_cancelled notice with no booking link and no code", async () => {
		const w = await world({ kind: "booking_cancelled", status: "cancelled" });
		const result = await drainEventsOutbox(w.deps());
		expect(result.sent).toBe(1);
		expect(w.sent[0]?.subject).toContain("cancelled");
		expect(w.sent[0]?.text).toContain("Winter Concert");
		expect(w.sent[0]?.text).not.toContain("k=");
		expect(w.booking().redeemHash).toBeUndefined();
		expect(row(w, `cancel-${ID}`).status).toBe("sent");
	});
});

describe("R22 outbox drain budget", () => {
	it("R22 drains one message per tick: 8 bridge calls for a one-off event, 9 for an occurrence", async () => {
		expect(OUTBOX_PER_TICK).toBe(1);
		const one = await world();
		await drainEventsOutbox(one.deps());
		expect(meter.calls).toBe(8);
		meter.calls = 0;
		const rec = await world({ occurrence: true });
		await drainEventsOutbox(rec.deps());
		expect(meter.calls).toBe(9);
	});

	it("R22 a second queued message waits for the next tick", async () => {
		const w = await world();
		w.storage.outbox.set("confirm-other", { ...row(w, `confirm-${ID}`) });
		const first = await drainEventsOutbox(w.deps());
		expect(first).toMatchObject({ sent: 1, remainingHint: true });
		expect((await drainEventsOutbox(w.deps())).sent).toBe(1);
	});

	it("R22 an empty tick is one bridge call", async () => {
		const w = await world();
		w.storage.outbox.docs.clear();
		await drainEventsOutbox(w.deps());
		expect(meter.calls).toBe(1);
	});
});
