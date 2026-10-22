import { describe, expect, it } from "vitest";

import {
	type AttendeeSignature,
	mergeSignature,
	parseReceiptRef,
	receiptAttendeeIds,
	seatIds,
	type VerifiedReceipt,
} from "../../src/domain/receipts";

// Receipt bookkeeping (EV-FR-12, SX-FR-04; esign-intent/1 §8.4): a receipt's `ref` names a booking
// (mode `buyer`) or one seat of it (mode `each_attendee`); storing it is idempotent and monotonic.

const H = (c: string) => c.repeat(64);
const receipt = (over: Partial<VerifiedReceipt> = {}): VerifiedReceipt => ({
	envelopeId: "env_1",
	ref: "ABCDEFGHJK:1",
	status: "completed",
	docSha256: H("a"),
	pdfSha256: H("b"),
	finalHash: H("c"),
	at: 1_800_000_000,
	...over,
});
const stored = (r: VerifiedReceipt): AttendeeSignature => ({
	envelopeId: r.envelopeId,
	status: r.status,
	docSha256: r.docSha256,
	pdfSha256: r.pdfSha256,
	finalHash: r.finalHash,
	at: r.at,
});

describe("receipt refs (EV-FR-12)", () => {
	it("EV-FR-12 parses <bookingRef> and <bookingRef>:<seat>, and refuses anything else", () => {
		expect(parseReceiptRef("ABCDEFGHJK")).toEqual({ bookingRef: "ABCDEFGHJK" });
		expect(parseReceiptRef("ABCDEFGHJK:3")).toEqual({ bookingRef: "ABCDEFGHJK", seat: 3 });
		for (const bad of [
			"",
			"ABCDEFGHJK:",
			"ABCDEFGHJK:0",
			"ABCDEFGHJK:01",
			"ABCDEFGHJK:x",
			"abcdefghjk",
			"ABC:1",
			"ABCDEFGHJK:1:2",
		]) {
			expect(parseReceiptRef(bad), bad).toBeNull();
		}
	});

	it("EV-FR-12 seats are <bookingId>-1..n over every line", () => {
		const booking = { lines: [{ qty: 2 }, { qty: 1 }] };
		expect(seatIds("bk_1", booking)).toEqual(["bk_1-1", "bk_1-2", "bk_1-3"]);
	});

	it("EV-FR-12 each_attendee receipts name one existing seat; buyer receipts cover every seat", () => {
		const each = { lines: [{ qty: 2 }], waiver: { templateId: "t", mode: "each_attendee" as const } };
		const buyer = { lines: [{ qty: 2 }], waiver: { templateId: "t", mode: "buyer" as const } };
		expect(receiptAttendeeIds("bk_1", each, { bookingRef: "R", seat: 2 })).toEqual(["bk_1-2"]);
		expect(receiptAttendeeIds("bk_1", each, { bookingRef: "R", seat: 3 })).toBeNull();
		expect(receiptAttendeeIds("bk_1", each, { bookingRef: "R" })).toBeNull();
		expect(receiptAttendeeIds("bk_1", buyer, { bookingRef: "R" })).toEqual(["bk_1-1", "bk_1-2"]);
		expect(receiptAttendeeIds("bk_1", buyer, { bookingRef: "R", seat: 1 })).toBeNull();
		expect(receiptAttendeeIds("bk_1", { lines: [{ qty: 1 }] }, { bookingRef: "R", seat: 1 })).toBeNull();
	});
});

describe("storing a receipt (SX-FR-04, §8.4 idempotent and monotonic)", () => {
	it("SX-FR-04 the first receipt is stored with its envelope id", () => {
		expect(mergeSignature(undefined, receipt())).toEqual(stored(receipt()));
	});

	it("SX-FR-04 the same receipt twice is a no-op", () => {
		expect(mergeSignature(stored(receipt()), receipt())).toBeNull();
		const declined = receipt({ status: "declined", pdfSha256: null, finalHash: null });
		expect(mergeSignature(stored(declined), declined)).toBeNull();
	});

	it("SX-FR-04 a completed receipt is final: no non-completed receipt replaces it", () => {
		const done = stored(receipt());
		for (const status of ["declined", "voided", "expired"] as const) {
			expect(mergeSignature(done, receipt({ status, pdfSha256: null, finalHash: null, at: 1_900_000_000 }))).toBeNull();
		}
		// Nor does another envelope's completed receipt.
		expect(mergeSignature(done, receipt({ envelopeId: "env_2", at: 1_900_000_000 }))).toBeNull();
	});

	it("SX-FR-04 a completed receipt with the PDF hash supersedes the same envelope's with pdfSha256 null", () => {
		const early = receipt({ pdfSha256: null });
		expect(mergeSignature(stored(early), receipt())).toEqual(stored(receipt()));
		// Not when another field differs, and never the other way round.
		expect(mergeSignature(stored(early), receipt({ finalHash: H("d") }))).toBeNull();
		expect(mergeSignature(stored(receipt()), early)).toBeNull();
	});

	it("SX-FR-04 a completed receipt replaces a declined, voided or expired one", () => {
		const declined = stored(receipt({ envelopeId: "env_0", status: "declined", pdfSha256: null, finalHash: null }));
		expect(mergeSignature(declined, receipt({ at: 1_700_000_000 }))).toEqual(stored(receipt({ at: 1_700_000_000 })));
	});

	it("T067 SX-FR-05 the re-issued mark survives a replay of the old receipt and goes with the new envelope's", () => {
		const declined = receipt({ status: "declined", pdfSha256: null, finalHash: null });
		const marked = { ...stored(declined), reissued: true };
		expect(mergeSignature(marked, declined)).toBeNull();
		const next = receipt({ envelopeId: "env_2", status: "expired", pdfSha256: null, finalHash: null, at: declined.at + 60 });
		expect(mergeSignature(marked, next)).toEqual(stored(next));
	});

	it("SX-FR-04 among non-completed receipts a later `at` wins", () => {
		const declined = receipt({ status: "declined", pdfSha256: null, finalHash: null });
		const voided = receipt({
			envelopeId: "env_2",
			status: "voided",
			pdfSha256: null,
			finalHash: null,
			at: declined.at + 60,
		});
		expect(mergeSignature(stored(declined), voided)).toEqual(stored(voided));
		expect(mergeSignature(stored(voided), declined)).toBeNull();
	});
});
