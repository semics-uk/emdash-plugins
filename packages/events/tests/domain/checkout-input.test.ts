/**
 * R42: the checkout body parsers keep the exact behaviour of the zod/mini schemas they replaced
 * (T047/T048 shipped them on zod/mini; T118 dropped zod from the bundle). The reference schemas
 * below are those originals, verbatim; every input must give the same value or the same issues
 * (path and code, in order), so clients and the booking widget see no change.
 */
import { describe, expect, it } from "vitest";
import { z } from "zod/mini";

import {
	MAX_LINES,
	MAX_QTY_PER_LINE,
	parseBookingAccessInput,
	parseContinueInput,
	parseReserveInput,
} from "../../src/domain/checkout";

const docId = z.string().check(z.minLength(1), z.maxLength(200));
const email = z.pipe(z.string().check(z.trim(), z.toLowerCase(), z.maxLength(254)), z.email());

const reserveReference = z.strictObject({
	eventId: docId,
	occurrenceId: z.optional(docId),
	lines: z
		.array(
			z.strictObject({
				ticketTypeId: docId,
				qty: z.int().check(z.minimum(1), z.maximum(MAX_QTY_PER_LINE)),
			}),
		)
		.check(z.minLength(1), z.maxLength(MAX_LINES)),
	buyer: z.strictObject({
		name: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
		email,
	}),
	idempotencyKey: z.string().check(z.regex(/^[A-Za-z0-9_-]{32,128}$/)),
	turnstileToken: z.optional(z.string().check(z.maxLength(2048))),
});

const bookingRef = z.string().check(z.regex(/^[0-9A-HJKMNP-TV-Z]{10}$/));
const accessToken = z.string().check(z.regex(/^[A-Za-z0-9_-]{43}$/));

const continueReference = z.strictObject({
	bookingRef,
	accessToken,
	attendees: z.optional(
		z
			.array(
				z.strictObject({
					ticketTypeId: docId,
					name: z.string().check(z.trim(), z.minLength(1), z.maxLength(200)),
					email: z.optional(email),
					minor: z.optional(z.boolean()),
				}),
			)
			.check(z.minLength(1), z.maxLength(MAX_LINES * MAX_QTY_PER_LINE)),
	),
});

const accessReference = z.strictObject({ bookingRef, accessToken });

function reference(schema: z.ZodMiniType, raw: unknown) {
	const parsed = schema.safeParse(raw);
	if (parsed.success) return { ok: true, value: parsed.data };
	return {
		ok: false,
		error: parsed.error.issues.map((i) => ({ path: i.path.length > 0 ? i.path.join(".") : "input", code: i.code })),
	};
}

const KEY = "k".repeat(32);
const REF = "ABCDEFGH12";
const TOKEN = "t".repeat(43);
const line = { ticketTypeId: "tt_a", qty: 2 };
const buyer = { name: "Ada", email: "Ada@Example.com" };
const reserve = { eventId: "e1", lines: [line], buyer, idempotencyKey: KEY };

/** Values of every type, plus the edge cases each validator branches on. */
const scalars: unknown[] = [
	undefined,
	null,
	true,
	false,
	0,
	1,
	-1,
	1.5,
	-2.5,
	50,
	51,
	2 ** 53,
	-(2 ** 53),
	2 ** 60,
	-(2 ** 60),
	Number.NaN,
	Number.POSITIVE_INFINITY,
	Number.NEGATIVE_INFINITY,
	"",
	" ",
	"x",
	" Ada ",
	"a@b.co",
	" A@B.CO ",
	"not-an-email",
	"a..b@c.co",
	".a@b.co",
	"a.@b.co",
	"a@b",
	"a@-b.co",
	"o'neil+tag@sub.example.org",
	"é@b.co",
	`${"x".repeat(250)}@b.co`,
	"x".repeat(200),
	"x".repeat(201),
	"x".repeat(2048),
	"x".repeat(2049),
	KEY,
	`${"x".repeat(31)}/`,
	"k".repeat(128),
	"k".repeat(129),
	REF,
	"abcdefgh12",
	"ABCDEFGHI1",
	TOKEN,
	"t".repeat(42),
	[],
	{},
	[1],
];

function* reserveCases(): Generator<unknown> {
	yield* scalars;
	yield reserve;
	yield { ...reserve, turnstileToken: "tok", occurrenceId: "o1" };
	yield { ...reserve, occurrenceId: undefined, turnstileToken: undefined };
	yield { ...reserve, extra: 1, other: 2 };
	yield JSON.parse(`{"__proto__":{"x":1},"eventId":"e1"}`);
	yield { ...reserve, lines: Array.from({ length: 11 }, () => line) };
	yield { ...reserve, lines: Array.from({ length: 12 }, () => ({ ticketTypeId: "", qty: 2 ** 60 })) };
	yield { ...reserve, lines: [{ qty: 0.5, x: 1 }, 3, null, []] };
	yield { idempotencyKey: "x", buyer: { email: 5, name: "x".repeat(201) }, lines: [] };
	yield { ...reserve, buyer: { name: "", email: "" } };
	yield { ...reserve, buyer: { name: " ", email: " A@B.CO ", phone: "1" } };
	for (const v of scalars) {
		yield { ...reserve, eventId: v };
		yield { ...reserve, occurrenceId: v };
		yield { ...reserve, lines: v };
		yield { ...reserve, lines: [v] };
		yield { ...reserve, lines: [{ ...line, qty: v }] };
		yield { ...reserve, lines: [{ ...line, ticketTypeId: v }] };
		yield { ...reserve, buyer: v };
		yield { ...reserve, buyer: { ...buyer, name: v } };
		yield { ...reserve, buyer: { ...buyer, email: v } };
		yield { ...reserve, idempotencyKey: v };
		yield { ...reserve, turnstileToken: v };
	}
}

const attendee = { ticketTypeId: "tt_a", name: "Ada" };
const cont = { bookingRef: REF, accessToken: TOKEN };

function* continueCases(): Generator<unknown> {
	yield* scalars;
	yield cont;
	yield { ...cont, attendees: [attendee, { ...attendee, email: " B@C.CO ", minor: true }] };
	yield { ...cont, attendees: undefined };
	yield { ...cont, attendees: [] };
	yield { ...cont, attendees: Array.from({ length: 501 }, () => attendee) };
	yield { ...cont, attendees: [{ ...attendee, extra: 1 }], more: 1 };
	for (const v of scalars) {
		yield { ...cont, bookingRef: v };
		yield { ...cont, accessToken: v };
		yield { ...cont, attendees: v };
		yield { ...cont, attendees: [v] };
		yield { ...cont, attendees: [{ ...attendee, ticketTypeId: v }] };
		yield { ...cont, attendees: [{ ...attendee, name: v }] };
		yield { ...cont, attendees: [{ ...attendee, email: v }] };
		yield { ...cont, attendees: [{ ...attendee, minor: v }] };
	}
}

describe("checkout body parsers keep the zod/mini behaviour (R42)", () => {
	it("R42 parseReserveInput gives the same value or issues as the zod/mini schema", () => {
		for (const raw of reserveCases()) {
			expect(parseReserveInput(raw), JSON.stringify(raw)?.slice(0, 200)).toStrictEqual(
				reference(reserveReference, raw),
			);
		}
	});

	it("R42 parseContinueInput gives the same value or issues as the zod/mini schema", () => {
		for (const raw of continueCases()) {
			expect(parseContinueInput(raw), JSON.stringify(raw)?.slice(0, 200)).toStrictEqual(
				reference(continueReference, raw),
			);
		}
	});

	it("R42 parseBookingAccessInput gives the same value or issues as the zod/mini schema", () => {
		for (const raw of continueCases()) {
			expect(parseBookingAccessInput(raw), JSON.stringify(raw)?.slice(0, 200)).toStrictEqual(
				reference(accessReference, raw),
			);
		}
	});
});
